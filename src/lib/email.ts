/**
 * Fresh-side email facade.
 *
 * Each per-template helper composes the spec, renders to HTML+text, and
 * POSTs an HMAC-signed payload to the Cloudflare Email Worker (deployed at
 * `https://mail.polaris.express`). The worker handles per-recipient rate
 * limits, nonce dedup, sender allowlist, and the actual delivery via
 * Cloudflare Email Service.
 *
 * Dev fallback: if `CF_EMAIL_WORKER_URL` is not set, OR if `DENO_ENV` is
 * "development" and `CF_EMAIL_WORKER_SECRET` is missing, we log the
 * rendered email to the console instead of POSTing. Production with a
 * missing secret throws — silent failure on auth flows is worse than a
 * loud one.
 *
 * Lifecycle emails (`welcome`, `account-reactivated`, `account-inactive`)
 * are intentionally NOT exported. The plan's silent-lifecycle directive
 * forbids them.
 */

import { config } from "./config.ts";
import { logger } from "./utils/logger.ts";
import { renderTemplate } from "./email/template.tsx";
import {
  buildMagicLinkEmail,
  type MagicLinkInputs,
} from "./email/magic-link.tsx";
import {
  buildSessionSummaryEmail,
  type SessionSummaryData,
} from "./email/session-summary.tsx";
import {
  buildReservationCancelledEmail,
  type ReservationData,
} from "./email/reservation-cancelled.tsx";
import { buildAdminPasswordResetEmail } from "./email/admin-password-reset.tsx";
import type { EmailCategory, RenderedEmail } from "./email/types.ts";

const log = logger.child("Email");

/** Payload sent to the Cloudflare Email Worker. */
export interface SendEmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
  category: EmailCategory;
  /** RFC 5322 From: header — Worker validates against allowlist. */
  from: string;
  replyTo: string;
  headers?: Record<string, string>;
}

interface SignedBody extends SendEmailPayload {
  ts: number;
  nonce: string;
}

const textEncoder = new TextEncoder();

function hexEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < view.length; i++) {
    s += view[i].toString(16).padStart(2, "0");
  }
  return s;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function signBody(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, textEncoder.encode(body));
  return hexEncode(sig);
}

function isDevModeFallback(): boolean {
  // Dev fallback: no worker URL OR (dev environment AND no secret).
  if (!config.CF_EMAIL_WORKER_URL) return true;
  if (config.DENO_ENV === "development" && !config.CF_EMAIL_WORKER_SECRET) {
    return true;
  }
  return false;
}

/**
 * POST a signed email payload to the Cloudflare Email Worker.
 *
 * In dev (no worker URL or no secret in dev mode), falls back to logging
 * the rendered email instead.
 *
 * In production, throws on missing secret — silently failing on auth
 * flows like magic-link is worse than a loud error.
 */
export async function sendEmail(payload: SendEmailPayload): Promise<void> {
  if (isDevModeFallback()) {
    const ctaUrl = extractFirstUrl(payload.text);
    log.info("DEV MODE — email not sent (no Worker URL configured)", {
      to: payload.to,
      category: payload.category,
      subject: payload.subject,
      from: payload.from,
      cta_url: ctaUrl ?? "(none)",
    });
    // First 500 chars of HTML — useful for visual sanity-check in dev logs
    // without dumping a full email payload.
    console.log("---- HTML PREVIEW (first 500 chars) ----");
    console.log(payload.html.slice(0, 500));
    console.log("---- TEXT PREVIEW ----");
    console.log(payload.text);
    console.log("---- END EMAIL PREVIEW ----");
    return;
  }

  if (!config.CF_EMAIL_WORKER_URL) {
    throw new Error("CF_EMAIL_WORKER_URL not configured");
  }
  if (!config.CF_EMAIL_WORKER_SECRET) {
    throw new Error("CF_EMAIL_WORKER_SECRET not configured");
  }

  const signed: SignedBody = {
    ts: Date.now(),
    nonce: generateNonce(),
    ...payload,
  };
  const body = JSON.stringify(signed);
  const sig = await signBody(config.CF_EMAIL_WORKER_SECRET, body);

  const url = `${config.CF_EMAIL_WORKER_URL.replace(/\/+$/, "")}/send`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-polaris-sig": sig,
      },
      body,
    });
  } catch (err) {
    log.error("Email worker request failed", {
      category: payload.category,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error(
      `Email worker request failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    log.error("Email worker rejected send", {
      category: payload.category,
      status: res.status,
      detail: detail.slice(0, 200),
    });
    throw new Error(
      `Email worker returned ${res.status}: ${detail.slice(0, 200)}`,
    );
  }

  log.info("email sent", {
    category: payload.category,
    // Don't log the recipient — keep parity with the Worker's PII rules.
  });
}

/** Pull the first http(s) URL out of a plain-text body. Used for dev logging. */
function extractFirstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/\S+/);
  return m ? m[0] : null;
}

function payloadFromRendered(
  rendered: RenderedEmail,
  to: string,
): SendEmailPayload {
  return {
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    category: rendered.category,
    from: rendered.fromHeader,
    replyTo: rendered.replyTo,
  };
}

// ---- Per-template helpers --------------------------------------------------

/** Magic-link sign-in email — triggered when a customer enters their email
 *  at `polaris.express/login`. */
export async function sendCustomerMagicLink(
  email: string,
  url: string,
): Promise<void> {
  const inputs: MagicLinkInputs = { to: email, url };
  const rendered = renderTemplate(buildMagicLinkEmail(inputs));
  await sendEmail(payloadFromRendered(rendered, email));
}

/** Charging-session summary — fired by Track H from
 *  `notification.service.ts` on `session.complete`. */
export async function sendSessionSummary(
  email: string,
  session: SessionSummaryData,
): Promise<void> {
  const rendered = renderTemplate(
    buildSessionSummaryEmail({ to: email, session }),
  );
  await sendEmail(payloadFromRendered(rendered, email));
}

/** Reservation cancellation notification — fired from the cancel flow. */
export async function sendReservationCancelled(
  email: string,
  reservation: ReservationData,
  reason?: string,
): Promise<void> {
  const rendered = renderTemplate(
    buildReservationCancelledEmail({ to: email, reservation, reason }),
  );
  await sendEmail(payloadFromRendered(rendered, email));
}

/** Admin password-reset email — admin-only flow from `manage.polaris.express`. */
export async function sendAdminPasswordReset(
  email: string,
  url: string,
): Promise<void> {
  const rendered = renderTemplate(
    buildAdminPasswordResetEmail({ to: email, url }),
  );
  await sendEmail(payloadFromRendered(rendered, email));
}

// Intentionally NOT exported (per the silent-lifecycle directive in the plan):
//   - sendCustomerWelcome
//   - sendAccountReactivated
//   - sendAccountInactive

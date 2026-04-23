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
 * Whether outbound email is *advertisable* to end users.
 *
 * Returns true when either:
 *   - dev mode is active (sends are logged to console — devs see them)
 *   - prod has BOTH `CF_EMAIL_WORKER_URL` and `CF_EMAIL_WORKER_SECRET` set
 *
 * Server-side loaders pass this flag to islands so the UI can hide
 * email-dependent options (magic-link sign-in, admin forgot-password)
 * when the worker isn't configured. Without this, customers see
 * "Email me a sign-in link" → submit → "Check your email" → wait
 * forever for a link that never arrives.
 *
 * Note: this is a STATIC config check, not a runtime liveness probe.
 * If the worker URL/secret are set but the worker happens to be down,
 * this still reports `true` and the UI shows email options. Users
 * will see the standard "check your email" message; the email won't
 * arrive but they can request another or use the scan flow. Add a
 * background liveness ping later if outages become frequent.
 */
export function isEmailEnabled(): boolean {
  if (isDevModeFallback()) return true;
  return Boolean(
    config.CF_EMAIL_WORKER_URL && config.CF_EMAIL_WORKER_SECRET,
  );
}

/** Outcome of an outbound email attempt. Helpers NEVER throw. */
export type SendEmailResult =
  | { ok: true; status: "sent" | "logged_dev" }
  | {
    ok: false;
    status: "skipped_no_email" | "misconfigured" | "worker_error";
    reason: string;
  };

/**
 * POST a signed email payload to the Cloudflare Email Worker.
 *
 * Graceful-degradation contract: this function NEVER throws. Worker
 * outages, missing-config, network errors, 5xx responses — all are
 * captured into a `SendEmailResult` and returned. Callers that need to
 * react (e.g. surface "we're having trouble emailing you" UX) inspect
 * `result.ok`; callers that just want to fire-and-forget can ignore
 * the result.
 *
 * In dev (no worker URL configured, or DENO_ENV=development without
 * a secret), the rendered email is logged to console instead.
 *
 * In production with the URL set but the secret missing, this is
 * misconfiguration — we log loudly and return `worker_error` rather
 * than crashing. Operations should alert on `[Email] worker_error`
 * counts spiking.
 */
export async function sendEmail(
  payload: SendEmailPayload,
): Promise<SendEmailResult> {
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
    return { ok: true, status: "logged_dev" };
  }

  if (!config.CF_EMAIL_WORKER_URL) {
    log.error(
      "Email worker URL missing in production — skipping send",
      { category: payload.category },
    );
    return {
      ok: false,
      status: "misconfigured",
      reason: "CF_EMAIL_WORKER_URL not configured",
    };
  }
  if (!config.CF_EMAIL_WORKER_SECRET) {
    log.error(
      "Email worker secret missing in production — skipping send",
      { category: payload.category },
    );
    return {
      ok: false,
      status: "misconfigured",
      reason: "CF_EMAIL_WORKER_SECRET not configured",
    };
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
      // Defend against a hung Worker — give up after 10s rather than
      // tying up the auth/notification flow indefinitely.
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error("Email worker request failed — skipping send", {
      category: payload.category,
      error: reason,
    });
    return { ok: false, status: "worker_error", reason };
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    log.error("Email worker rejected send — skipping", {
      category: payload.category,
      status: res.status,
      detail: detail.slice(0, 200),
    });
    return {
      ok: false,
      status: "worker_error",
      reason: `Worker returned ${res.status}: ${detail.slice(0, 200)}`,
    };
  }

  log.info("email sent", {
    category: payload.category,
    // Don't log the recipient — keep parity with the Worker's PII rules.
  });
  return { ok: true, status: "sent" };
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

/**
 * True when an email is usable for outbound sends. Customer accounts may
 * have null/empty email (auto-provisioned from Lago customers without
 * one — see `customer-account-provisioner.ts`). Every customer-bound
 * helper checks this first and silently skips so callers never have to
 * special-case null-email accounts at every site.
 */
export function hasUsableEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().length > 0;
}

/**
 * Skip-result for missing-email short-circuits — keeps the caller's
 * inspect-result code path uniform with worker-side outcomes.
 */
function skippedNoEmail(reason: string): SendEmailResult {
  return { ok: false, status: "skipped_no_email", reason };
}

/**
 * Magic-link sign-in email — triggered when a customer enters their email
 * at `polaris.express/login`. NEVER throws — returns a result object.
 */
export async function sendCustomerMagicLink(
  email: string | null | undefined,
  url: string,
): Promise<SendEmailResult> {
  if (!hasUsableEmail(email)) {
    log.info("Skipping sendCustomerMagicLink — no usable email", { url });
    return skippedNoEmail("recipient has no email on file");
  }
  try {
    const inputs: MagicLinkInputs = { to: email as string, url };
    const rendered = await renderTemplate(buildMagicLinkEmail(inputs));
    return await sendEmail(payloadFromRendered(rendered, email as string));
  } catch (err) {
    // Render failures are bugs (template producing invalid HTML) — log
    // but don't crash the auth flow.
    const reason = err instanceof Error ? err.message : String(err);
    log.error("sendCustomerMagicLink: render failed", { reason });
    return { ok: false, status: "worker_error", reason };
  }
}

/**
 * Charging-session summary — fired by Track H from
 * `notification.service.ts` on `session.complete`. NEVER throws.
 */
export async function sendSessionSummary(
  email: string | null | undefined,
  session: SessionSummaryData,
): Promise<SendEmailResult> {
  if (!hasUsableEmail(email)) {
    log.info("Skipping sendSessionSummary — no usable email", {
      session_id: session?.id,
    });
    return skippedNoEmail("recipient has no email on file");
  }
  try {
    const rendered = await renderTemplate(
      buildSessionSummaryEmail({ to: email as string, session }),
    );
    return await sendEmail(payloadFromRendered(rendered, email as string));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error("sendSessionSummary: render failed", { reason });
    return { ok: false, status: "worker_error", reason };
  }
}

/** Reservation cancellation notification — fired from the cancel flow. */
export async function sendReservationCancelled(
  email: string | null | undefined,
  reservation: ReservationData,
  reason?: string,
): Promise<SendEmailResult> {
  if (!hasUsableEmail(email)) {
    log.info("Skipping sendReservationCancelled — no usable email", {
      charger: reservation?.chargerName,
    });
    return skippedNoEmail("recipient has no email on file");
  }
  try {
    const rendered = await renderTemplate(
      buildReservationCancelledEmail({
        to: email as string,
        reservation,
        reason,
      }),
    );
    return await sendEmail(payloadFromRendered(rendered, email as string));
  } catch (err) {
    const renderErr = err instanceof Error ? err.message : String(err);
    log.error("sendReservationCancelled: render failed", { reason: renderErr });
    return { ok: false, status: "worker_error", reason: renderErr };
  }
}

/** Admin password-reset email — admin-only flow from `manage.polaris.express`. */
export async function sendAdminPasswordReset(
  email: string | null | undefined,
  url: string,
): Promise<SendEmailResult> {
  // Admin accounts always have an email by construction (no path creates an
  // emailless admin), but guard anyway so a stale code path can't 500.
  if (!hasUsableEmail(email)) {
    log.warn("Skipping sendAdminPasswordReset — no usable email", { url });
    return skippedNoEmail("recipient has no email on file");
  }
  try {
    const rendered = await renderTemplate(
      buildAdminPasswordResetEmail({ to: email as string, url }),
    );
    return await sendEmail(payloadFromRendered(rendered, email as string));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log.error("sendAdminPasswordReset: render failed", { reason });
    return { ok: false, status: "worker_error", reason };
  }
}

// Intentionally NOT exported (per the silent-lifecycle directive in the plan):
//   - sendCustomerWelcome
//   - sendAccountReactivated
//   - sendAccountInactive

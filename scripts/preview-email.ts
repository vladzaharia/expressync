#!/usr/bin/env -S deno run -A
/**
 * Email preview script.
 *
 * Renders any of the 4 email templates to `_email-preview.html` for
 * browser inspection. Run via:
 *
 *   deno run -A scripts/preview-email.ts                  # index page
 *   deno run -A scripts/preview-email.ts magic-link       # one template
 *   deno run -A scripts/preview-email.ts session-summary
 *   deno run -A scripts/preview-email.ts reservation-cancelled
 *   deno run -A scripts/preview-email.ts admin-password-reset
 *   deno run -A scripts/preview-email.ts magic-link --send=alice@vlad.gg
 *     (smoke test against the real Worker — requires CF_EMAIL_WORKER_URL set)
 *
 * Output: `_email-preview.html` in the project root (gitignored).
 */

import { renderTemplate } from "../src/lib/email/template.tsx";
import { buildMagicLinkEmail } from "../src/lib/email/magic-link.tsx";
import { buildSessionSummaryEmail } from "../src/lib/email/session-summary.tsx";
import { buildReservationCancelledEmail } from "../src/lib/email/reservation-cancelled.tsx";
import { buildAdminPasswordResetEmail } from "../src/lib/email/admin-password-reset.tsx";
import {
  sendAdminPasswordReset,
  sendCustomerMagicLink,
  sendReservationCancelled,
  sendSessionSummary,
} from "../src/lib/email.ts";

type TemplateName =
  | "magic-link"
  | "session-summary"
  | "reservation-cancelled"
  | "admin-password-reset";

const TEMPLATES: TemplateName[] = [
  "magic-link",
  "session-summary",
  "reservation-cancelled",
  "admin-password-reset",
];

async function renderByName(name: TemplateName) {
  switch (name) {
    case "magic-link":
      return await renderTemplate(
        buildMagicLinkEmail({
          to: "preview@example.com",
          url: "https://polaris.express/auth/verify?token=preview-token-xyz",
        }),
      );
    case "session-summary":
      return await renderTemplate(
        buildSessionSummaryEmail({
          to: "preview@example.com",
          session: {
            id: "txn_preview123",
            chargerName: "Polaris HQ — Bay 2",
            started: "Apr 22, 2026 at 14:32",
            ended: "Apr 22, 2026 at 15:19",
            duration: "47 min",
            energy: "12.34 kWh",
            cost: "$4.56",
            cardLabel: "Tesla card (•••• 7421)",
          },
        }),
      );
    case "reservation-cancelled":
      return await renderTemplate(
        buildReservationCancelledEmail({
          to: "preview@example.com",
          reservation: {
            chargerName: "Polaris HQ — Bay 2",
            date: "Apr 22, 2026",
            time: "14:00 – 15:00",
          },
          reason: "Charger taken offline for unscheduled maintenance.",
        }),
      );
    case "admin-password-reset":
      return await renderTemplate(
        buildAdminPasswordResetEmail({
          to: "ops@example.com",
          url: "https://manage.polaris.express/reset-password?token=preview",
        }),
      );
  }
}

async function sendByName(name: TemplateName, to: string) {
  switch (name) {
    case "magic-link":
      await sendCustomerMagicLink(
        to,
        "https://polaris.express/auth/verify?token=smoke-test-token",
      );
      return;
    case "session-summary":
      await sendSessionSummary(to, {
        id: "txn_smoketest",
        chargerName: "Polaris HQ — Bay 2",
        started: "Apr 22, 2026 at 14:32",
        ended: "Apr 22, 2026 at 15:19",
        duration: "47 min",
        energy: "12.34 kWh",
        cost: "$4.56",
        cardLabel: "Tesla card (•••• 7421)",
      });
      return;
    case "reservation-cancelled":
      await sendReservationCancelled(
        to,
        {
          chargerName: "Polaris HQ — Bay 2",
          date: "Apr 22, 2026",
          time: "14:00 – 15:00",
        },
        "Charger taken offline for unscheduled maintenance.",
      );
      return;
    case "admin-password-reset":
      await sendAdminPasswordReset(
        to,
        "https://manage.polaris.express/reset-password?token=smoke",
      );
      return;
  }
}

async function indexHtml(): Promise<string> {
  const cards = (await Promise.all(TEMPLATES.map(async (name) => {
    const r = await renderByName(name);
    return `
<section style="margin-bottom:32px;border:1px solid #e5e7eb;border-radius:8px;padding:16px;background:#fff;">
  <h2 style="margin:0 0 8px;font-family:system-ui;">${name}</h2>
  <dl style="margin:0;font-family:system-ui;font-size:14px;color:#374151;">
    <dt style="font-weight:600;display:inline;">Subject:</dt>
    <dd style="display:inline;margin:0 0 4px;">${escapeHtml(r.subject)}</dd><br>
    <dt style="font-weight:600;display:inline;">Preheader (${r.preheader.length} chars):</dt>
    <dd style="display:inline;margin:0;">${escapeHtml(r.preheader)}</dd><br>
    <dt style="font-weight:600;display:inline;">From:</dt>
    <dd style="display:inline;margin:0;">${escapeHtml(r.fromHeader)}</dd>
  </dl>
  <details style="margin-top:12px;">
    <summary style="cursor:pointer;font-family:system-ui;font-size:14px;color:#0e7c66;">Show rendered HTML</summary>
    <iframe srcdoc="${
      escapeAttr(r.html)
    }" style="width:100%;height:600px;border:1px solid #e5e7eb;margin-top:8px;"></iframe>
  </details>
  <details style="margin-top:8px;">
    <summary style="cursor:pointer;font-family:system-ui;font-size:14px;color:#0e7c66;">Show plain-text version</summary>
    <pre style="background:#f3f4f6;padding:12px;border-radius:4px;font-size:12px;white-space:pre-wrap;margin-top:8px;">${
      escapeHtml(r.text)
    }</pre>
  </details>
</section>`;
  }))).join("");

  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>Polaris Express — email preview index</title>
</head>
<body style="margin:0;padding:32px;background:#f4f1ec;font-family:system-ui;">
<h1 style="margin:0 0 24px;">Polaris Express — email preview index</h1>
<p style="margin:0 0 24px;color:#4b5563;">
  Renders all 4 templates with fixture data. Run <code>deno run -A scripts/preview-email.ts &lt;name&gt;</code>
  for the full standalone HTML, or <code>--send=user@example.com</code> for an end-to-end Worker smoke test.
</p>
${cards}
</body></html>`;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// ---- Entry ---------------------------------------------------------------

const args = Deno.args.filter((a) => !a.startsWith("--"));
const sendArg = Deno.args.find((a) => a.startsWith("--send="));
const sendTo = sendArg ? sendArg.split("=", 2)[1] : null;

const target = args[0] as TemplateName | undefined;

if (target && !TEMPLATES.includes(target)) {
  console.error(`Unknown template "${target}". Valid: ${TEMPLATES.join(", ")}`);
  Deno.exit(1);
}

const outputPath = "_email-preview.html";

if (!target) {
  await Deno.writeTextFile(outputPath, await indexHtml());
  console.log(`Wrote index of ${TEMPLATES.length} templates → ${outputPath}`);
  console.log(`Open it in a browser:`);
  console.log(`  xdg-open ${outputPath}    # Linux`);
  console.log(`  open ${outputPath}        # macOS`);
} else {
  const r = await renderByName(target);
  await Deno.writeTextFile(outputPath, r.html);
  console.log(`Wrote ${target} → ${outputPath}`);
  console.log(`Subject:   ${r.subject}`);
  console.log(`Preheader: (${r.preheader.length} chars) ${r.preheader}`);
  console.log(`From:      ${r.fromHeader}`);
  console.log(`---- text version ----`);
  console.log(r.text);

  if (sendTo) {
    if (!Deno.env.get("CF_EMAIL_WORKER_URL")) {
      console.error("--send requires CF_EMAIL_WORKER_URL to be set.");
      Deno.exit(1);
    }
    console.log(`\nSending real email to ${sendTo}…`);
    await sendByName(target, sendTo);
    console.log("Sent (check the Worker logs to confirm delivery).");
  }
}

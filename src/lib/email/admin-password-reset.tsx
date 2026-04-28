/**
 * Admin-password-reset email — sent when an operator clicks "Forgot
 * password?" on the admin login at `manage.polaris.express/login`.
 *
 * Brand: ExpresSync (not Polaris). From: admin-noreply@polaris.express
 * (separate sender address gives admins a visible inbox cue that this is an
 * operator email, not a customer comms).
 *
 * 24-hour TTL is enforced by the auth layer; the copy mirrors that.
 */

import type { EmailTemplate } from "./types.ts";

export interface AdminPasswordResetInputs {
  to: string;
  url: string;
}

export function buildAdminPasswordResetEmail(
  inputs: AdminPasswordResetInputs,
): EmailTemplate {
  const { url } = inputs;
  return {
    brand: "expressync",
    category: "admin-password-reset",
    subject: "Reset your admin password",
    preheader:
      "Use the button below to reset your ExpressCharge operator password. Link expires in 24 hours.",
    title: "Reset your admin password",
    body: [
      {
        type: "paragraph",
        text:
          "We received a request to reset the password for your ExpressCharge operator account.",
      },
      {
        type: "highlight",
        text: "This link expires in 24 hours and can only be used once.",
      },
    ],
    cta: {
      label: "Reset password",
      url,
      variant: "primary",
    },
    footerNote:
      "Didn't request this? You can safely ignore this email — your password won't change.",
  };
}

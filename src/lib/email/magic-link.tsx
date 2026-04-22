/**
 * Magic-link email — sent when a customer enters their email at
 * `polaris.express/login` and Better-Auth issues a magic link.
 *
 * The URL is the POST-confirm landing (defeats email previewers from
 * consuming the token on first hit). 15-minute TTL is configured on the
 * Better-Auth side; the email mirrors that copy.
 */

import type { EmailTemplate } from "./types.ts";

export interface MagicLinkInputs {
  to: string;
  url: string;
}

export function buildMagicLinkEmail(inputs: MagicLinkInputs): EmailTemplate {
  const { url } = inputs;
  return {
    brand: "polaris",
    category: "magic-link",
    subject: "Sign in to Polaris Express",
    preheader:
      "Tap the button below to sign in. This link expires in 15 minutes.",
    title: "Sign in to Polaris Express",
    body: [
      {
        type: "paragraph",
        text:
          "Use the button below to finish signing in to your Polaris Express account.",
      },
      {
        type: "highlight",
        text: "This link expires in 15 minutes.",
      },
    ],
    cta: {
      label: "Sign in",
      url,
      variant: "primary",
    },
    footerNote: "Didn't request this? Ignore this email.",
  };
}

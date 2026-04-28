/**
 * Brand assets for the email subsystem.
 *
 * One entry per `EmailBrand`. The hex colours are calibrated to survive all
 * three classes of dark-mode behaviour (full inversion / partial inversion /
 * no dark mode) — see the customer-portal plan's "Safe palette" section.
 *
 * Logo URLs point to a hosted asset bucket (R2 behind
 * `assets.polaris.express`). PNG only — Outlook strips inline SVG. Track J
 * is responsible for uploading the PNGs before the first send.
 */

import type { EmailBrand } from "./types.ts";

export interface BrandAssets {
  name: string;
  wordmark: string;
  logoUrl: string;
  logoUrl2x: string;
  primaryHex: string;
  primaryDark: string;
  fromHeader: string;
  replyTo: string;
}

export const BRAND_ASSETS: Record<EmailBrand, BrandAssets> = {
  polaris: {
    name: "ExpressCharge",
    wordmark: "ExpressCharge",
    logoUrl: "https://assets.polaris.express/email/polaris-logo-160.png",
    logoUrl2x: "https://assets.polaris.express/email/polaris-logo-320.png",
    primaryHex: "#0E7C66",
    primaryDark: "#34D399",
    fromHeader: "ExpressCharge <noreply@polaris.express>",
    replyTo: "support@polaris.express",
  },
  expressync: {
    name: "ExpressCharge",
    wordmark: "ExpressCharge",
    logoUrl: "https://assets.polaris.express/email/expressync-logo-160.png",
    logoUrl2x: "https://assets.polaris.express/email/expressync-logo-320.png",
    primaryHex: "#1561C4",
    primaryDark: "#5FB1E8",
    fromHeader: "ExpressCharge Operator <admin-noreply@polaris.express>",
    replyTo: "support@polaris.express",
  },
} as const;

/** Hosts we let through the URL allowlist for CTAs / inline links. */
export const ALLOWED_URL_PREFIXES = [
  "https://polaris.express",
  "https://manage.polaris.express",
  "mailto:",
] as const;

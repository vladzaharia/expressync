/**
 * Email subsystem — type contracts.
 *
 * `EmailTemplate` is the high-level spec each per-template builder produces;
 * `renderTemplate(spec)` (in template.tsx) consumes it and emits a
 * `RenderedEmail` ready to be POSTed to the Cloudflare Email Worker.
 *
 * Brand selection drives header/footer styling, primary colour, sender
 * address, and reply-to. The `category` is forwarded to the Worker for
 * rate-limiting + observability and is one of the values defined in the
 * customer-portal plan; lifecycle categories (`welcome`,
 * `account-reactivated`, `account-inactive`) are intentionally part of the
 * type but **not exported** as Fresh-side helpers — the silent-lifecycle
 * directive forbids actually sending those.
 */

export type EmailBrand = "polaris" | "expressync";

export interface EmailCta {
  label: string;
  /** MUST start with one of the allowlisted hosts (https://polaris.express,
   *  https://manage.polaris.express, mailto:). Validated at render time. */
  url: string;
  variant?: "primary" | "secondary";
}

export interface MetadataRow {
  label: string;
  value: string;
  /** Bold the value (e.g. cost row in session summary). */
  emphasis?: boolean;
}

export type EmailBlock =
  | { type: "paragraph"; text: string }
  | { type: "highlight"; text: string }
  | { type: "code"; text: string }
  | { type: "divider" };

/**
 * Categories we know about. Fresh-side helpers are only exported for the
 * non-lifecycle ones; the rest are reserved by the type so the Worker can
 * still classify if a different surface introduces them later.
 */
export type EmailCategory =
  | "magic-link"
  | "welcome"
  | "session-summary"
  | "reservation-cancelled"
  | "account-reactivated"
  | "admin-password-reset"
  | "invoice-available"
  | "account-inactive";

export interface EmailTemplate {
  brand: EmailBrand;
  category: EmailCategory;
  /** ≤ 50 chars (validated at render). */
  subject: string;
  /** 40–110 chars (validated at render). Hidden in the body, shown in the
   *  inbox preview alongside the subject. */
  preheader: string;
  /** H1 inside the card. */
  title: string;
  body: EmailBlock[];
  cta?: EmailCta;
  /** 2-column key/value table — usually rendered between body and CTA. */
  metadata?: MetadataRow[];
  /** Small fine-print above the legal footer. */
  footerNote?: string;
}

export interface RenderedEmail {
  subject: string;
  preheader: string;
  /** Full `<!doctype html>…</html>` document with all CSS inlined. */
  html: string;
  /** CRLF-delimited plain-text alternative derived from `body` blocks. */
  text: string;
  /** RFC 5322 `From:` header, brand-derived. */
  fromHeader: string;
  /** Reply-To address, brand-derived. */
  replyTo: string;
  category: EmailCategory;
}

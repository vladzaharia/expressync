/**
 * Shape of a single card in the Privacy Policy / Terms of Service stack.
 *
 * The card layout is the entire point of these pages: every legally-load
 * bearing topic lives in its own card so a customer can scan summaries,
 * tap one open, and read just that body. Strings are written for the
 * customer; legalese is glossed inline rather than relegated to a glossary.
 */

export interface LegalCard {
  /** kebab-case slug used as the DOM `id` (anchor link target). */
  id: string;
  /** Lucide icon name (rendered via `lucide-preact`). */
  icon: string;
  /** 2-5 word card title. */
  title: string;
  /** One-sentence plain-English statement, always visible. */
  summary: string;
  /** 1-3 short paragraphs of the legally-precise body. */
  body: string;
  /** Optional bullet list rendered after the body. */
  bullets?: string[];
}

export interface LegalDocumentMeta {
  /** Document title (e.g., "Privacy Policy"). */
  title: string;
  /** Short description rendered in the page-card header. */
  description: string;
  /** ISO date — when this document took effect. */
  effectiveDate: string;
  /** Where to email questions / data requests / contract notices. */
  contactEmail: string;
}

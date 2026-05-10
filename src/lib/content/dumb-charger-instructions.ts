/**
 * Shared user-instructions text for unmanaged chargers.
 *
 * Used by the public web fallback (`routes/c/[chargerId].tsx`) and the
 * admin "User instructions preview" SectionCard on the unmanaged charger
 * detail page. Keeping these in one module means rewording the steps
 * doesn't require touching three surfaces — the iOS app keeps its own
 * platform-idiomatic copy and is allowed to drift.
 */

export const DUMB_CHARGER_HEADLINE = "Plug in. Charge. Free.";

export const DUMB_CHARGER_STEPS: readonly string[] = [
  "Plug in your cable.",
  "Your car negotiates power automatically.",
  "Unplug when you're done.",
];

export const DUMB_CHARGER_SUPPORT_EMAIL = "support@example.com";

/**
 * Per-kind armed-state step copy for `ScanPanel`.
 *
 * `ScanPanel` accepts a `state.steps?: string[]` override on the `armed`
 * variant and falls back to a generic 3-step list ("Wake your card / Tap
 * it on {reader} / We'll handle the rest") when no override is supplied.
 * The copy varies subtly by tap-target kind:
 *
 *   - **Charger** ("Wake your card / Tap it on {label} / We'll handle the
 *     rest") — matches the existing customer login wizard wording. Most
 *     deployments today are charger-only.
 *   - **Phone** ("Unlock your phone / Tap your card on {label} / We'll
 *     handle the rest") — the operator's own iPhone is the reader, so the
 *     prep step is unlocking instead of waking the card.
 *   - **Laptop / other** ("Wake your card / Tap it on {label} / We'll
 *     handle the rest") — same as charger; the laptop's NFC sensor is
 *     just another reader.
 *
 * Single source so the customer-login `mapCustomerFlowToPanelState` and
 * the admin `TapToAddModal` stay in sync without copy-pasting strings.
 */

import type { TapTargetEntry } from "@/src/lib/types/devices.ts";
import { tapTargetDisplayName } from "@/components/scan/display-name.ts";

const FALLBACK_LABEL = "the reader";
const TRAILING = "We'll handle the rest";

/**
 * Three-step list to render in `ScanPanel` armed state, derived from the
 * resolved tap-target. `target` may be `null` when the picker hasn't
 * resolved yet; in that case we return a generic list so the panel can
 * still render meaningful copy.
 */
export function stepsForTarget(
  target: TapTargetEntry | null,
): string[] {
  const label = tapTargetDisplayName(target) || FALLBACK_LABEL;
  const kind = target?.kind ?? "charger";
  if (kind === "phone_nfc") {
    return [
      "Unlock your phone",
      `Tap your card on ${label}`,
      TRAILING,
    ];
  }
  // Charger and laptop_nfc share the "wake the card" wording — the user
  // is bringing the card to a fixed reader in both cases.
  return [
    "Wake your card",
    `Tap it on ${label}`,
    TRAILING,
  ];
}

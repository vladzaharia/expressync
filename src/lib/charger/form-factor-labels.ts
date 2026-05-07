/**
 * Single source of truth for charger form-factor display labels.
 *
 * Imported by every UI that renders the form factor as text — the
 * unmanaged charger create form, device cards, charger detail
 * header, etc. Replaces the duplicated `FORM_FACTOR_LABEL` maps that
 * used to live in `islands/devices/DeviceCard.tsx` and
 * `islands/devices/NewUnmanagedChargerForm.tsx`.
 */

import type { FormFactor } from "@/src/lib/types/steve.ts";

export const FORM_FACTOR_LABEL: Record<FormFactor, string> = {
  wallbox: "Wallbox",
  tesla: "Tesla Wall Connector",
  generic: "Charger",
};

/**
 * ScanTagPaletteHost — invisible island that mounts a `TapToAddModal` once
 * at the document root and opens it when the global `evcard:scan-open`
 * CustomEvent fires. The Command Palette dispatches that event after the
 * operator has chosen which tap-target to scan at, so the scan flow is
 * reachable from anywhere without bolting a button onto every page.
 *
 * Event payload (Wave 4 D3):
 *   `CustomEvent<{ deviceId?: string; pairableType?: 'charger'|'device';
 *                  label?: string }>`.
 * Pre-D3 callers passing `{ chargeBoxId }` are still honoured via the
 * legacy alias for one release; new code should use `deviceId` +
 * `pairableType`.
 *
 * On detection, default behavior matches `ScanTagAction.tsx`:
 *   - existing tag → /tags/{tagPk}
 *   - unknown tag  → /tags/new?idTag=<scanned>
 *
 * Lives in `_app.tsx` (admin surface only). Mirrors the decoupled
 * dispatch pattern already used by `PaletteTriggerPill` → `cmdk:open`.
 */

import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import TapToAddModal from "./TapToAddModal.tsx";
import type { ScanResult } from "@/islands/shared/use-scan-tag.ts";
import type { TapTargetEntry } from "@/src/lib/types/devices.ts";
import { clientNavigate } from "@/src/lib/nav.ts";

export const SCAN_OPEN_EVENT = "evcard:scan-open";

export interface ScanOpenDetail {
  /** Tap-target identifier (UUID for phones, chargeBoxId for chargers).
   *  Omit to let the modal auto-discover. */
  deviceId?: string;
  /** Pairable kind of `deviceId`. Required when `deviceId` is a phone
   *  UUID; defaults to `'charger'` if omitted. */
  pairableType?: TapTargetEntry["pairableType"];
  /** Optional human label for the chosen target — used as the
   *  `panelSubtitle` so the modal shows e.g. "Tap a card on Garage". */
  label?: string;
  /**
   * Backward-compat alias for `deviceId` (with `pairableType: 'charger'`).
   *
   * @deprecated Use `deviceId` + `pairableType: 'charger'`.
   */
  chargeBoxId?: string;
}

export default function ScanTagPaletteHost() {
  const open = useSignal(false);
  const deviceId = useSignal<string | undefined>(undefined);
  const pairableType = useSignal<TapTargetEntry["pairableType"]>("charger");
  const label = useSignal<string | undefined>(undefined);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<ScanOpenDetail | undefined>).detail;
      const id = detail?.deviceId ?? detail?.chargeBoxId;
      deviceId.value = id;
      // Default to charger when only the legacy alias was passed; that
      // matches the pre-D3 contract exactly.
      pairableType.value = detail?.pairableType ??
        (detail?.deviceId ? "charger" : "charger");
      label.value = detail?.label;
      open.value = true;
    };
    globalThis.addEventListener(SCAN_OPEN_EVENT, onOpen as EventListener);
    return () =>
      globalThis.removeEventListener(SCAN_OPEN_EVENT, onOpen as EventListener);
  }, []);

  const handleDetected = (r: ScanResult) => {
    open.value = false;
    const dest = r.exists && typeof r.tagPk === "number"
      ? `/tags/${r.tagPk}`
      : `/tags/new?idTag=${encodeURIComponent(r.idTag)}`;
    clientNavigate(dest);
  };

  const subtitle = label.value
    ? `Tap an RFID/NFC card on ${label.value} to look it up or add it to inventory.`
    : "Tap an RFID/NFC card on the chosen tap-target to look it up or add it to inventory.";

  return (
    <TapToAddModal
      open={open.value}
      onOpenChange={(next) => (open.value = next)}
      onDetected={handleDetected}
      deviceId={deviceId.value}
      pairableType={pairableType.value}
      panelTitle="Scan Tag"
      panelSubtitle={subtitle}
    />
  );
}

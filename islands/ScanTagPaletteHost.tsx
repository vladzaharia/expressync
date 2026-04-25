/**
 * ScanTagPaletteHost — invisible island that mounts a `TapToAddModal` once
 * at the document root and opens it when the global `evcard:scan-open`
 * CustomEvent fires. The Command Palette dispatches that event after the
 * operator has chosen which charger to scan at, so the scan flow is
 * reachable from anywhere without bolting a button onto every page.
 *
 * Event payload: `CustomEvent<{ chargeBoxId?: string }>`. When
 * `chargeBoxId` is set the modal pre-arms against that specific charger
 * (no in-modal picker step). When omitted, the modal falls back to its
 * own auto-discovery / picker.
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
import { clientNavigate } from "@/src/lib/nav.ts";

export const SCAN_OPEN_EVENT = "evcard:scan-open";

export interface ScanOpenDetail {
  /** Charger to arm against; omit to let the modal auto-discover. */
  chargeBoxId?: string;
}

export default function ScanTagPaletteHost() {
  const open = useSignal(false);
  const chargeBoxId = useSignal<string | undefined>(undefined);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<ScanOpenDetail | undefined>).detail;
      chargeBoxId.value = detail?.chargeBoxId;
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

  return (
    <TapToAddModal
      open={open.value}
      onOpenChange={(next) => (open.value = next)}
      onDetected={handleDetected}
      chargeBoxId={chargeBoxId.value}
      panelTitle="Scan EV Card"
      panelSubtitle="Tap an RFID/NFC card on the chosen charger reader to look it up or add it to inventory."
    />
  );
}

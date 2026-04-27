/**
 * TriggerScanButton — `headerActions`-slot button on the device detail
 * page. Dispatches the global `evcard:scan-open` CustomEvent (handled
 * by `ScanTagPaletteHost` mounted in `_app.tsx`) with this device as
 * the pre-selected tap-target. The host opens the unified scan modal,
 * which arms `/api/admin/devices/{deviceId}/scan-arm` and subscribes
 * to the per-device scan-detect SSE stream.
 *
 * Disabled while the device isn't currently online — `scan-arm` rejects
 * stale heartbeats and the modal would just bounce off `503`.
 */

import { Button } from "@/components/ui/button.tsx";
import { ScanLine } from "lucide-preact";
import {
  SCAN_OPEN_EVENT,
  type ScanOpenDetail,
} from "@/islands/ScanTagPaletteHost.tsx";

export interface TriggerScanButtonProps {
  deviceId: string;
  /** Friendly label shown as the modal subtitle ("Tap a card on …"). */
  label: string;
  /** When false, the device hasn't beat in the heartbeat window —
   *  scan-arm would reject. We grey out the button instead. */
  isOnline: boolean;
}

export default function TriggerScanButton(
  { deviceId, label, isOnline }: TriggerScanButtonProps,
) {
  const handleClick = () => {
    const detail: ScanOpenDetail = {
      deviceId,
      pairableType: "device",
      label,
    };
    globalThis.dispatchEvent(
      new CustomEvent(SCAN_OPEN_EVENT, { detail }),
    );
  };

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleClick}
      disabled={!isOnline}
      title={isOnline
        ? `Open the scan modal for ${label}`
        : "Device is offline — scan-arm requires a recent heartbeat."}
    >
      <ScanLine class="size-4" />
      Trigger scan
    </Button>
  );
}

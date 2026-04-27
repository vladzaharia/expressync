/**
 * TriggerScanButton — `headerActions`-slot button on the device detail
 * page. Dispatches `evcard:scan-open` with this device pre-selected.
 * The shared `<ScanModalHost>` opens the unified modal which arms
 * `/api/admin/devices/{deviceId}/scan-arm` and listens on the per-device
 * scan-detect SSE stream.
 *
 * Disabled while the device isn't currently online — scan-arm rejects
 * stale heartbeats.
 */

import { Button } from "@/components/ui/button.tsx";
import { ScanLine } from "lucide-preact";
import {
  SCAN_OPEN_EVENT,
  type ScanOpenDetail,
} from "@/islands/shared/ScanModalHost.tsx";

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
      mode: "admin",
      purpose: "lookup-tag",
      preselected: { deviceId, pairableType: "device" },
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

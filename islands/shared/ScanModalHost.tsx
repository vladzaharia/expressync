/**
 * ScanModalHost — invisible island mounted at the document root that
 * listens for `evcard:scan-open` CustomEvent and opens `<ScanModal>` with
 * the requested mode + purpose. Replaces the legacy `ScanTagPaletteHost`
 * (which was admin-only and pre-D3 only handled the command-palette
 * shortcut).
 *
 * Event payload:
 *   CustomEvent<ScanOpenDetail>
 *   {
 *     mode: "admin",                  // customer mode is embedded inline,
 *                                     // not driven through the host
 *     purpose: "add-tag" | "lookup-tag",
 *     preselected?: { deviceId, pairableType },
 *     resolveKind?: "default-route" | "callback",
 *     callbackId?: string,            // legacy — ignored; pass via opener
 *     label?: string,                 // friendly name for the modal subtitle
 *   }
 *
 * The host only handles admin-mode dispatches. Customer-mode embeds the
 * `<ScanFlow>` directly inside the login wizard so there's no global
 * popover-on-popover layering on the public surface.
 */

import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import ScanModal from "@/islands/shared/ScanModal.tsx";
import type { ScanPurpose } from "@/islands/shared/use-unified-scan.ts";

export const SCAN_OPEN_EVENT = "evcard:scan-open";

export interface ScanOpenDetail {
  mode?: "admin"; // customer flows don't use the host
  purpose?: ScanPurpose;
  preselected?: {
    deviceId: string;
    pairableType: "device" | "charger";
  };
  /** Free label for the modal subtitle. */
  label?: string;
  /**
   * Routing kind on resolution:
   *   - "default" (default): existing tag → /tags/{tagPk}; unknown → /tags/new
   *   - "scan-another": same routing as default (caller can extend).
   */
  resolveKind?: "default";
}

export default function ScanModalHost() {
  const open = useSignal(false);
  const purpose = useSignal<ScanPurpose>("lookup-tag");
  const preselected = useSignal<ScanOpenDetail["preselected"] | undefined>(
    undefined,
  );
  const label = useSignal<string | undefined>(undefined);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<ScanOpenDetail | undefined>).detail;
      purpose.value = detail?.purpose ?? "lookup-tag";
      preselected.value = detail?.preselected;
      label.value = detail?.label;
      open.value = true;
    };
    globalThis.addEventListener(SCAN_OPEN_EVENT, onOpen as EventListener);
    return () =>
      globalThis.removeEventListener(SCAN_OPEN_EVENT, onOpen as EventListener);
  }, []);

  return (
    <ScanModal
      open={open.value}
      onOpenChange={(v) => (open.value = v)}
      mode="admin"
      purpose={purpose.value}
      preselectedId={preselected.value}
      modalTitle={purpose.value === "add-tag" ? "Add a tag" : "Scan Tag"}
      subtitle={label.value ? `Tap a card on ${label.value}.` : undefined}
      resolve={{
        kind: "route",
        build: (r) =>
          r.exists && typeof r.tagPk === "number"
            ? `/tags/${r.tagPk}`
            : `/tags/new?idTag=${encodeURIComponent(r.idTag)}`,
      }}
    />
  );
}

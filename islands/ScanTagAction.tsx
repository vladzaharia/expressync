import { useSignal } from "@preact/signals";
import { Radio } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import TapToAddModal from "./TapToAddModal.tsx";
import type { ScanResult } from "@/islands/shared/use-scan-tag.ts";
import type { AccentColor } from "@/src/lib/colors.ts";

/**
 * Header-action island on /tags (and any other page that wants a
 * "scan a tag" affordance). Opens the `TapToAddModal`; on successful
 * detection either forwards the `ScanResult` to the caller-supplied
 * `onDetected`, or falls back to the default routing:
 *   - existing tag → `/tags/{tagPk}`
 *   - unknown tag  → `/tags/new?idTag=<scanned>`
 *
 * When `onDetected` is set the caller owns routing entirely; this island
 * just closes the modal after the callback resolves.
 */
interface Props {
  /**
   * Caller-supplied handler. When set, the default routing is suppressed
   * and the caller is responsible for navigation / UI follow-up.
   */
  onDetected?: (r: ScanResult) => void | Promise<void>;
  /** Override the button caption. Defaults to "Scan Tag". */
  buttonLabel?: string;
  /** Hand through to `TapToAddModal`. */
  confirmMode?: "auto" | "manual";
  timeoutSeconds?: number;
  /** Themes the modal BorderBeam / countdown ring. Defaults to cyan. */
  accent?: AccentColor;
}

export default function ScanTagAction(
  {
    onDetected,
    buttonLabel = "Scan Tag",
    confirmMode,
    timeoutSeconds,
    accent,
  }: Props,
) {
  const open = useSignal(false);

  const handleDetected = async (r: ScanResult) => {
    if (onDetected) {
      try {
        await onDetected(r);
      } finally {
        open.value = false;
      }
      return;
    }
    // Default behavior: route to the tag page (if known) or the new-tag
    // creation flow. We intentionally do NOT fall through to the new-tag
    // page on transient errors anymore — the modal's `lookup_failed`
    // state owns that recovery so the operator sees what failed.
    const dest = r.exists && typeof r.tagPk === "number"
      ? `/tags/${r.tagPk}`
      : `/tags/new?idTag=${encodeURIComponent(r.idTag)}`;
    globalThis.location.href = dest;
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => (open.value = true)}
      >
        <Radio class="mr-2 h-4 w-4" />
        {buttonLabel}
      </Button>
      <TapToAddModal
        open={open.value}
        onOpenChange={(next) => (open.value = next)}
        onDetected={handleDetected}
        confirmMode={confirmMode}
        timeoutSeconds={timeoutSeconds}
        accent={accent}
      />
    </>
  );
}

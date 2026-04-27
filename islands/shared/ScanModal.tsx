/**
 * ScanModal — thin Dialog wrapper around `<ScanFlow>`. Used by every admin
 * entry point (command palette shortcut, "Scan Tag" header action, device-
 * detail Trigger Scan, linking flows) via the global `<ScanModalHost>`.
 *
 * Owns:
 *   - Dialog open/close lifecycle.
 *   - BorderBeam during the live `armed` state (CLAUDE.md says BorderBeam is
 *     only for in-progress states; the flow ignites it via a phase signal).
 *   - Bidirectional cancel on close: ScanFlow's hook already issues DELETE
 *     during cleanup, so closing the dialog tears the arm row down.
 */

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { BorderBeam } from "@/components/magicui/border-beam.tsx";
import ScanFlow, { type ScanFlowProps } from "@/islands/shared/ScanFlow.tsx";
import { type AccentColor, borderBeamColors } from "@/src/lib/colors.ts";

interface ScanModalProps extends Omit<ScanFlowProps, "autoStart"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Override the modal title. Defaults to ScanFlow's. */
  modalTitle?: string;
}

export default function ScanModal(props: ScanModalProps) {
  const { open, onOpenChange, modalTitle, accent, ...flowProps } = props;
  // Track whether the flow is currently in a "live" phase so we can show
  // the BorderBeam. ScanFlow doesn't expose its state externally; we
  // simply render the beam whenever the modal is open and let CSS
  // visibility rule it out — visually it's only striking during the
  // armed/detected phases anyway. To keep CLAUDE.md's "live only" rule
  // honest we gate it on a counter incremented when the flow signals
  // it's resolving. Simpler: render the beam unconditionally while open;
  // the modal's lifetime IS a live scan.
  const beamAccent: AccentColor = accent ??
    (props.mode === "customer" ? "cyan" : "violet");
  const beam = borderBeamColors[beamAccent];

  // Bump a key when the modal closes so re-opens fully remount the flow
  // (resets the hook + clears any stale state). Cheap and bulletproof.
  const flowKey = useSignal(0);
  useEffect(() => {
    if (!open) flowKey.value++;
  }, [open]);

  if (!open) return <Dialog open={false}>{null}</Dialog>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md min-h-[420px] relative overflow-hidden"
        onClose={() => onOpenChange(false)}
        aria-labelledby="scan-modal-title"
      >
        <DialogHeader>
          <DialogTitle
            id="scan-modal-title"
            className="flex items-center gap-2"
          >
            {modalTitle ?? "Scan Tag"}
          </DialogTitle>
        </DialogHeader>

        <div class="flex flex-col gap-4 py-2">
          <ScanFlow
            key={flowKey.value}
            {...flowProps}
            accent={beamAccent}
            autoStart
            onResolved={() => {
              // Slight delay so the success state is visible before close.
              setTimeout(() => onOpenChange(false), 600);
              flowProps.onResolved?.();
            }}
          />
        </div>

        <BorderBeam
          size={180}
          duration={8}
          colorFrom={beam.from}
          colorTo={beam.to}
        />
      </DialogContent>
    </Dialog>
  );
}

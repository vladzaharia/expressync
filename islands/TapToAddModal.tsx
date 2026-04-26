/**
 * TapToAddModal — the admin Scan Tag modal shell.
 *
 * Delegates state to `useScanTag`; the island only wires keyboard / focus
 * affordances and routes the resulting state through `ScanPanel` — the
 * shared visual primitive used by both the customer login wizard and the
 * admin scan flows. Per-state buttons + the manual-entry fallback live in
 * the `ScanModalActions` / `ScanModalExtras` helpers below; everything
 * visual (countdown ring, instructional copy, status icons, error chrome)
 * comes from `ScanPanel` so admins and customers see the same UI with
 * different copy.
 *
 * The `onTagDetected` legacy prop is preserved so the existing
 * `islands/linking/TagPicker.tsx` call site keeps working; new callers
 * should use `onDetected(result)` instead.
 *
 * The modal inherits the caller's `accent` colour: the BorderBeam,
 * countdown ring, and neutral-state iconography all use it. Semantic
 * states (success/warning/error) keep their fixed tones for clarity.
 */

import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { BorderBeam } from "@/components/magicui/border-beam.tsx";
import { BlurFade } from "@/components/magicui/blur-fade.tsx";
import { ExternalLink, Keyboard } from "lucide-preact";
import { type AccentColor, borderBeamColors } from "@/src/lib/colors.ts";
import {
  type ScanResult,
  type ScanTagState,
  useScanTag,
} from "@/islands/shared/use-scan-tag.ts";
import {
  adaptScanTagState,
  ScanPanel,
  shouldRenderBeam,
} from "@/components/scan/ScanPanel.tsx";
import { ManualEntryForm } from "@/components/scan/ManualEntryForm.tsx";
import { TagChip } from "@/components/tags/TagChip.tsx";
import { clientNavigate } from "@/src/lib/nav.ts";
import type { TapTargetEntry } from "@/src/lib/types/devices.ts";
import { stepsForTarget } from "@/components/scan/scan-steps.ts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timeoutSeconds?: number;
  confirmMode?: "auto" | "manual";
  /** Default true. When false, the "Enter manually" secondary is hidden. */
  allowManualEntry?: boolean;
  /**
   * Page accent that themes the modal chrome. Defaults to `cyan`
   * (the Tags page accent). BorderBeam, countdown ring, and neutral-state
   * icons all follow this. Semantic state colours are preserved.
   */
  accent?: AccentColor;
  /** Heading rendered inside `ScanPanel`. Defaults to "Scan a tag to add". */
  panelTitle?: string;
  /** Helper line under the title. */
  panelSubtitle?: string;
  /** Preferred callback; receives the full `ScanResult`. */
  onDetected?: (r: ScanResult) => void | Promise<void>;
  /**
   * LEGACY adapter — if supplied (and `onDetected` is not), called with
   * `r.idTag` on successful resolution. Retained only so the existing
   * `islands/linking/TagPicker.tsx` shape keeps compiling until the
   * Linking agent migrates. Do not add new call sites.
   */
  onTagDetected?: (idTag: string) => void;
  /**
   * Arm-intent endpoint. Defaults to `/api/admin/tag/scan-arm` so all
   * admin scan UIs use the pre-Authorize hook pipeline (works for known
   * AND unknown tags). Pass an explicit value (or `undefined`) only if
   * you need the legacy log-scrape path for diagnostics. The phone /
   * laptop branch always dispatches to
   * `/api/admin/devices/{deviceId}/scan-arm` regardless of this opt.
   */
  armEndpoint?: string;
  /**
   * Optional fixed tap-target to arm against. For phones / laptops this
   * is the device UUID; for chargers it's the chargeBoxId. When omitted
   * the hook auto-discovers via `/api/auth/scan-tap-targets` (preferring
   * the operator's own phone when exactly one is online; otherwise the
   * first online charger).
   */
  deviceId?: string;
  /**
   * Pairable type of `deviceId`. Required when `deviceId` is a phone
   * UUID; defaults to `'charger'` so pre-D3 callers keep working.
   */
  pairableType?: TapTargetEntry["pairableType"];
  /**
   * Backward-compat alias for `deviceId` (with `pairableType: 'charger'`).
   *
   * @deprecated Use `deviceId` + `pairableType: 'charger'`.
   */
  chargeBoxId?: string;
  /**
   * Free-text shown in the iOS push notification when the device branch
   * is taken (e.g. "Front desk"). Ignored for charger arms.
   */
  hintLabel?: string;
}

/** Countdown thresholds we announce via the `aria-live` region. */
const ANNOUNCE_AT = new Set([20, 15, 10, 5, 3, 2, 1]);

export default function TapToAddModal({
  open,
  onOpenChange,
  timeoutSeconds = 20,
  confirmMode = "manual",
  allowManualEntry = true,
  accent = "cyan",
  panelTitle = "Scan a tag to add",
  panelSubtitle = "Tap an RFID card on any online tap-target.",
  onDetected,
  onTagDetected,
  armEndpoint = "/api/admin/tag/scan-arm",
  deviceId,
  pairableType,
  chargeBoxId,
  hintLabel,
}: Props) {
  const handleDetected = async (r: ScanResult) => {
    if (onDetected) {
      await onDetected(r);
      return;
    }
    if (onTagDetected) {
      onTagDetected(r.idTag);
      return;
    }
    const dest = r.exists && typeof r.tagPk === "number"
      ? `/tags/${r.tagPk}`
      : `/tags/new?idTag=${encodeURIComponent(r.idTag)}`;
    clientNavigate(dest);
  };

  // The hook resolves a tap-target (either supplied via `deviceId` or
  // auto-discovered from /api/auth/scan-tap-targets) and reports it back
  // here so the panel can swap to per-kind copy ("Tap your card on Aisha's
  // iPhone" vs. "Tap it on Garage").
  const resolvedTarget = useSignal<TapTargetEntry | null>(null);

  const hook = useScanTag({
    timeoutSeconds,
    confirmMode,
    onDetected: handleDetected,
    armEndpoint,
    deviceId: deviceId ?? chargeBoxId,
    pairableType: pairableType ?? (deviceId ? undefined : "charger"),
    hintLabel,
    onTargetResolved: (target) => {
      resolvedTarget.value = target;
    },
  });

  const state = hook.state.value;
  const showManual = useSignal(false);
  const announceMessage = useSignal("");
  const lastAnnouncedRef = useRef<number | null>(null);
  const primaryCtaRef = useRef<HTMLButtonElement | null>(null);
  const retryCtaRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      showManual.value = false;
      announceMessage.value = "";
      lastAnnouncedRef.current = null;
      hook.open();
    } else {
      hook.close();
    }
  }, [open]);

  // Announce the transition into `connecting` so screen-reader users know
  // the modal is doing something before the waiting state kicks in.
  useEffect(() => {
    if (!open) return;
    if (state.kind === "connecting") {
      announceMessage.value = "Connecting…";
    }
  }, [state.kind, open]);

  // Countdown announcements (includes a final "timer expired" when it hits 0).
  const remainingDep = state.kind === "waiting" ? state.remaining : null;
  useEffect(() => {
    if (state.kind !== "waiting") return;
    const r = state.remaining;
    if (r === 0 && lastAnnouncedRef.current !== 0) {
      lastAnnouncedRef.current = 0;
      announceMessage.value = "Countdown finished";
      return;
    }
    if (ANNOUNCE_AT.has(r) && lastAnnouncedRef.current !== r) {
      lastAnnouncedRef.current = r;
      announceMessage.value = `${r} seconds remaining`;
    }
  }, [remainingDep]);

  useEffect(() => {
    if (state.kind === "resolving" || state.kind === "routing") {
      showManual.value = false;
    }
  }, [state.kind]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inEditable = !!target && (
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" ||
        target.isContentEditable
      );
      if (e.key === "Enter" && state.kind === "detected") {
        e.preventDefault();
        hook.confirm();
      } else if (
        (e.key === "r" || e.key === "R") && !inEditable &&
        (state.kind === "timeout" || state.kind === "unavailable" ||
          state.kind === "network_error" || state.kind === "lookup_failed")
      ) {
        e.preventDefault();
        hook.retry();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, state.kind]);

  useEffect(() => {
    if (!open) return;
    if (state.kind === "detected" && primaryCtaRef.current) {
      primaryCtaRef.current.focus();
    } else if (
      (state.kind === "timeout" || state.kind === "unavailable" ||
        state.kind === "network_error" || state.kind === "lookup_failed") &&
      retryCtaRef.current
    ) {
      retryCtaRef.current.focus();
    }
  }, [open, state.kind]);

  const handleClose = () => {
    onOpenChange(false);
  };

  const target = resolvedTarget.value;
  const basePanelState = adaptScanTagState(state, {
    total: timeoutSeconds,
    readerName: target?.label ?? null,
  });
  // Decorate the `armed` state with per-kind step copy now that we know
  // the resolved target's `kind`. Other states pass through unchanged.
  const panelState = basePanelState.kind === "armed"
    ? { ...basePanelState, steps: stepsForTarget(target) }
    : basePanelState;
  const showBeam = shouldRenderBeam(panelState);
  const beam = borderBeamColors[accent];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md min-h-[420px] relative overflow-hidden"
        onClose={handleClose}
        aria-labelledby="scan-tag-title"
        aria-describedby="scan-tag-body"
      >
        <DialogHeader>
          <DialogTitle id="scan-tag-title" className="flex items-center gap-2">
            Scan Tag
          </DialogTitle>
        </DialogHeader>

        <div
          id="scan-tag-body"
          class="flex flex-col gap-4 py-4 min-h-[300px]"
        >
          <BlurFade key={state.kind} duration={0.18}>
            <ScanPanel
              title={panelTitle}
              subtitle={panelSubtitle}
              accent={accent}
              prefersReducedMotion={hook.prefersReducedMotion}
              state={panelState}
              helpText={state.kind === "timeout" ||
                  state.kind === "unavailable" ||
                  state.kind === "network_error" ||
                  state.kind === "lookup_failed"
                ? "Press R to retry"
                : state.kind === "detected"
                ? (confirmMode === "auto"
                  ? "Opening in 0.8s… (cancel to scan another)"
                  : "Press Enter to open this tag")
                : undefined}
              actions={
                <ScanModalActions
                  state={state}
                  allowManualEntry={allowManualEntry}
                  showManual={showManual.value}
                  onToggleManual={() => (showManual.value = !showManual.value)}
                  onConfirm={hook.confirm}
                  onCancel={hook.cancel}
                  onExtend={hook.extend}
                  onRetry={hook.retry}
                  onClose={handleClose}
                  onManualSubmit={(v) => hook.submitManual(v)}
                  primaryCtaRef={primaryCtaRef}
                  retryCtaRef={retryCtaRef}
                />
              }
            >
              <ScanModalExtras
                state={state}
                showManual={showManual.value}
                allowManualEntry={allowManualEntry}
                onManualSubmit={(v) => hook.submitManual(v)}
              />
            </ScanPanel>
          </BlurFade>
        </div>

        <span class="sr-only" aria-live="polite" aria-atomic="true">
          {announceMessage.value}
        </span>

        {showBeam && (
          <BorderBeam
            size={180}
            duration={8}
            colorFrom={beam.from}
            colorTo={beam.to}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Per-state actions / extras for the admin scan modal.
//
// `ScanPanel` owns the canonical chrome (countdown ring, instructional copy,
// state icons, error chrome). The two helpers below tack on the admin-only
// affordances: cancel / try-again / open-tag buttons (`ScanModalActions`)
// and the optional manual-entry form (`ScanModalExtras`).
// ---------------------------------------------------------------------------

interface ActionProps {
  state: ScanTagState;
  showManual: boolean;
  onToggleManual: () => void;
  allowManualEntry: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onExtend: () => void;
  onRetry: () => void;
  onClose: () => void;
  onManualSubmit: (idTag: string) => void;
  primaryCtaRef: { current: HTMLButtonElement | null };
  retryCtaRef: { current: HTMLButtonElement | null };
}

/**
 * Tag chip + outcome row when the modal is in `detected` (admin-only — the
 * customer flow auto-completes login). Surfaced via the `children` slot of
 * `ScanPanel` so the canonical chrome above is unchanged.
 */
function ScanModalExtras({
  state,
  showManual,
  allowManualEntry,
  onManualSubmit,
}: {
  state: ScanTagState;
  showManual: boolean;
  allowManualEntry: boolean;
  onManualSubmit: (idTag: string) => void;
}) {
  if (state.kind === "detected") {
    return (
      <div class="flex justify-center">
        <TagChip
          idTag={state.idTag}
          tagPk={0}
          tagType={undefined}
          href={null}
        />
      </div>
    );
  }

  if (allowManualEntry && showManual) {
    return (
      <div class="w-full pt-2">
        <ManualEntryForm onSubmit={onManualSubmit} />
      </div>
    );
  }

  return null;
}

function ScanModalActions({
  state,
  allowManualEntry,
  showManual,
  onToggleManual,
  onConfirm,
  onCancel,
  onExtend,
  onRetry,
  onClose,
  onManualSubmit,
  primaryCtaRef,
  retryCtaRef,
}: ActionProps) {
  const manualBtn = allowManualEntry
    ? (
      <Button
        variant="outline"
        size="sm"
        onClick={onToggleManual}
        aria-expanded={showManual}
      >
        <Keyboard class="mr-1 size-4" aria-hidden="true" />
        Enter manually
      </Button>
    )
    : null;

  switch (state.kind) {
    case "idle":
    case "connecting":
      return (
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
      );

    case "waiting": {
      const lowTime = state.remaining <= 5;
      return (
        <>
          {lowTime && !state.extended && (
            <Button variant="ghost" size="sm" onClick={onExtend}>
              +20 seconds
            </Button>
          )}
          <Button
            ref={primaryCtaRef as unknown as never}
            variant="outline"
            size="sm"
            onClick={onClose}
          >
            Cancel
          </Button>
          {manualBtn}
        </>
      );
    }

    case "detected":
      return (
        <>
          <Button
            ref={primaryCtaRef as unknown as never}
            size="sm"
            onClick={onConfirm}
          >
            Open tag
          </Button>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Scan again
          </Button>
        </>
      );

    case "resolving":
    case "routing":
      return null;

    case "timeout":
    case "unavailable":
    case "network_error":
      return (
        <>
          <Button
            ref={retryCtaRef as unknown as never}
            size="sm"
            onClick={onRetry}
          >
            Try again
          </Button>
          {manualBtn}
        </>
      );

    case "lookup_failed":
      return (
        <>
          <Button
            ref={retryCtaRef as unknown as never}
            size="sm"
            onClick={() => onManualSubmit(state.idTag)}
          >
            Try again
          </Button>
          {manualBtn}
          <Button variant="outline" size="sm" asChild>
            <a
              href={`/tags/new?idTag=${encodeURIComponent(state.idTag)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink class="mr-1 size-4" aria-hidden="true" />
              Create new tag
            </a>
          </Button>
        </>
      );

    case "dismissed":
      return null;
  }
}

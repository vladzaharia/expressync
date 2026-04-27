/**
 * ScanFlow — embeddable picker → armed → result component for the
 * unified scan-tag UI.
 *
 * One component, three embedding sites:
 *   - Inside `<ScanModal>` — global modal mounted by `<ScanModalHost>`.
 *   - Inside `<CommandPalette>` — replaces the legacy inline picker
 *     subview so the palette can drive a complete scan without spawning
 *     a popover-on-popover.
 *   - Inside `<CustomerLoginWizard>` — replaces the legacy
 *     `CustomerScanLoginIsland` inline mode for the "Scan Card" step.
 *
 * State machine + side-effects live in `useUnifiedScan`. ScanFlow is a
 * pure renderer over the hook's state plus the action affordances:
 *   • Phase 1 (picker): full-width device cards via `<DevicePickerInline>`.
 *   • Phase 2 (armed):  `<ScanPanel>` armed view + footer split:
 *                       left "← Choose another device" back pill,
 *                       right "Enter manually" key-button (admin only).
 *                       Manual entry swaps the ring/steps in place.
 *   • Phase 3 (result): success or error+retry via `<ScanPanel>`.
 */

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { ArrowLeft, Keyboard, Loader2, ScanLine } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { BlurFade } from "@/components/magicui/blur-fade.tsx";
import { DevicePickerInline } from "@/components/scan/DevicePickerInline.tsx";
import { ManualEntryForm } from "@/components/scan/ManualEntryForm.tsx";
import {
  ScanPanel,
  type ScanPanelState,
} from "@/components/scan/ScanPanel.tsx";
import { tapTargetDisplayName } from "@/components/scan/display-name.ts";
import {
  type ResolveStrategy,
  type ScanFlowState,
  type ScanMode,
  type ScanPurpose,
  useUnifiedScan,
} from "@/islands/shared/use-unified-scan.ts";
import type { TapTargetEntry } from "@/src/lib/types/devices.ts";
import type { AccentColor } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";

export interface ScanFlowProps {
  mode: ScanMode;
  purpose: ScanPurpose;
  resolve: ResolveStrategy;
  /** Pre-selected target — skips the picker. */
  preselected?: TapTargetEntry;
  preselectedId?: { deviceId: string; pairableType: "device" | "charger" };
  /** When true, omit the "← Choose another device" back affordance — the
   *  caller has only one option and we don't want to invite a dead end. */
  hideBackToPicker?: boolean;
  /** Auto-start on mount. Default true. Set false if the embedding shell
   *  wants to defer (e.g. dialog opening). */
  autoStart?: boolean;
  /** Called once the flow reaches a terminal success state, after the
   *  resolve strategy fires. Embeddings that need to close themselves
   *  (the modal, the palette) wire this up. */
  onResolved?: () => void;
  /** Optional escape hatch — surfaced as a tertiary link beneath the
   *  panel (customer flows use this for "Use email instead"). */
  secondaryAction?: { label: string; onClick: () => void };
  /** Heading. Defaults to a copy appropriate for the mode. */
  title?: string;
  /** Helper line under the title. */
  subtitle?: string;
  accent?: AccentColor;
  class?: string;
  /** Free-text shown in the iOS push for device-mode admin scans. */
  hintLabel?: string | null;
}

function defaultTitle(mode: ScanMode, purpose: ScanPurpose): string {
  if (mode === "customer") return "Scan to sign in";
  if (purpose === "lookup-tag") return "Scan a tag";
  return "Scan a tag to add";
}

function pickerSubtitle(mode: ScanMode): string {
  if (mode === "customer") return "Pick a device to tap your card on.";
  return "Pick a tappable device to scan with.";
}

function armedSubtitle(target: TapTargetEntry, mode: ScanMode): string {
  const name = tapTargetDisplayName(target) || "the reader";
  if (mode === "customer") {
    return `Hold your card flat against ${name}.`;
  }
  return `We'll detect the tag on ${name} and look it up.`;
}

export default function ScanFlow(props: ScanFlowProps) {
  const {
    mode,
    purpose,
    resolve,
    preselected,
    preselectedId,
    hideBackToPicker = false,
    autoStart = true,
    onResolved,
    secondaryAction,
    title,
    subtitle,
    accent = mode === "customer" ? "cyan" : "violet",
    class: className,
    hintLabel,
  } = props;

  const scan = useUnifiedScan({
    mode,
    purpose,
    resolve,
    preselected,
    preselectedId,
    hintLabel,
  });

  const showManual = useSignal(false);

  useEffect(() => {
    if (autoStart) scan.start();
  }, [autoStart]);

  const state = scan.state.value;

  // Fire onResolved when we hit success (after the resolve strategy
  // has already run inside the hook — this just lets the embedding
  // close itself).
  useEffect(() => {
    if (state.kind === "success" && onResolved) {
      onResolved();
    }
  }, [state.kind]);

  // Reset manual-entry visibility when the phase changes away from armed.
  useEffect(() => {
    if (state.kind !== "armed") showManual.value = false;
  }, [state.kind]);

  const headerTitle = title ?? defaultTitle(mode, purpose);
  const headerSubtitle = subtitle ?? pickerSubtitleFromState(state, mode);

  return (
    <section
      class={cn("flex flex-col gap-4 min-h-[360px]", className)}
      aria-busy={state.kind === "loadingTargets" || state.kind === "arming" ||
        state.kind === "resolving"}
    >
      <header class="flex flex-col gap-1">
        <h3 class="text-base font-semibold leading-tight text-foreground">
          {headerTitle}
        </h3>
        {headerSubtitle && (
          <p class="text-xs text-muted-foreground leading-snug">
            {headerSubtitle}
          </p>
        )}
      </header>

      <BlurFade key={state.kind} duration={0.18}>
        <Body
          state={state}
          mode={mode}
          accent={accent}
          prefersReducedMotion={scan.prefersReducedMotion}
          onSelect={scan.selectTarget}
          onBackToPicker={scan.backToPicker}
          onRetry={scan.retry}
          onManualSubmit={scan.submitManual}
          showManual={showManual.value}
          onToggleManual={() => (showManual.value = !showManual.value)}
          hideBackToPicker={hideBackToPicker}
          allowManualEntry={mode === "admin"}
        />
      </BlurFade>

      {secondaryAction && state.kind !== "success" && (
        <div class="flex justify-center">
          <button
            type="button"
            class="text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={secondaryAction.onClick}
          >
            {secondaryAction.label}
          </button>
        </div>
      )}
    </section>
  );
}

function pickerSubtitleFromState(s: ScanFlowState, mode: ScanMode): string {
  switch (s.kind) {
    case "idle":
    case "loadingTargets":
    case "picker":
    case "noTargets":
      return pickerSubtitle(mode);
    case "arming":
    case "armed":
      return armedSubtitle(s.target, mode);
    default:
      return "";
  }
}

function Body({
  state,
  mode,
  accent,
  prefersReducedMotion,
  onSelect,
  onBackToPicker,
  onRetry,
  onManualSubmit,
  showManual,
  onToggleManual,
  hideBackToPicker,
  allowManualEntry,
}: {
  state: ScanFlowState;
  mode: ScanMode;
  accent: AccentColor;
  prefersReducedMotion: boolean;
  onSelect: (t: TapTargetEntry) => void;
  onBackToPicker: () => void;
  onRetry: () => void;
  onManualSubmit: (idTag: string) => void;
  showManual: boolean;
  onToggleManual: () => void;
  hideBackToPicker: boolean;
  allowManualEntry: boolean;
}) {
  switch (state.kind) {
    case "idle":
    case "loadingTargets":
      return <SkeletonRows />;
    case "picker":
      return (
        <DevicePickerInline
          devices={state.targets}
          selectedDeviceId={null}
          onSelect={onSelect}
          mode={mode}
          accent={accent}
        />
      );
    case "noTargets":
      return (
        <ScanPanel
          accent={accent}
          state={{
            kind: "error",
            message:
              "No tappable devices online right now. Try again in a moment.",
            onRetry,
          }}
          prefersReducedMotion={prefersReducedMotion}
        />
      );
    case "arming":
      return (
        <div class="flex flex-col items-center gap-2 py-8 text-center">
          <Loader2 class="size-6 animate-spin text-muted-foreground" />
          <p class="text-sm text-muted-foreground">
            Arming{" "}
            <span class="font-medium text-foreground">
              {tapTargetDisplayName(state.target)}
            </span>…
          </p>
        </div>
      );
    case "armed": {
      if (showManual) {
        return (
          <div class="flex flex-col gap-3">
            <ManualEntryForm onSubmit={onManualSubmit} />
            <button
              type="button"
              class="self-start text-xs text-muted-foreground underline-offset-4 hover:underline"
              onClick={onToggleManual}
            >
              ← Back to scan
            </button>
          </div>
        );
      }
      const panelState: ScanPanelState = {
        kind: "armed",
        remaining: state.remaining,
        total: 90,
        readerName: tapTargetDisplayName(state.target),
      };
      return (
        <div class="flex flex-col gap-3">
          <ScanPanel
            accent={accent}
            state={panelState}
            prefersReducedMotion={prefersReducedMotion}
          />
          <ArmedFooter
            hideBackToPicker={hideBackToPicker}
            allowManualEntry={allowManualEntry}
            onBackToPicker={onBackToPicker}
            onToggleManual={onToggleManual}
          />
        </div>
      );
    }
    case "detected":
      return (
        <ScanPanel
          accent={accent}
          state={{
            kind: "detected",
            idTag: state.idTag,
            message: "Looking up…",
          }}
          prefersReducedMotion={prefersReducedMotion}
        />
      );
    case "resolving":
      return (
        <ScanPanel
          accent={accent}
          state={{ kind: "resolving", message: `Looking up ${state.idTag}…` }}
          prefersReducedMotion={prefersReducedMotion}
        />
      );
    case "success":
      return (
        <ScanPanel
          accent={accent}
          state={{ kind: "success", message: state.message ?? "Done." }}
          prefersReducedMotion={prefersReducedMotion}
        />
      );
    case "error":
      return (
        <ScanPanel
          accent={accent}
          state={{
            kind: "error",
            message: state.message,
            onRetry: state.canRetry ? onRetry : undefined,
          }}
          prefersReducedMotion={prefersReducedMotion}
        />
      );
  }
}

function ArmedFooter({
  hideBackToPicker,
  allowManualEntry,
  onBackToPicker,
  onToggleManual,
}: {
  hideBackToPicker: boolean;
  allowManualEntry: boolean;
  onBackToPicker: () => void;
  onToggleManual: () => void;
}) {
  return (
    <div class="flex items-center justify-between gap-2">
      {!hideBackToPicker
        ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBackToPicker}
          >
            <ArrowLeft class="mr-1 size-4" aria-hidden="true" />
            Choose another device
          </Button>
        )
        : <span />}
      {allowManualEntry
        ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onToggleManual}
            title="Enter the tag ID by hand"
          >
            <Keyboard class="mr-1 size-4" aria-hidden="true" />
            Enter manually
          </Button>
        )
        : <span />}
    </div>
  );
}

function SkeletonRows() {
  return (
    <div class="flex flex-col gap-2" aria-hidden="true">
      <div class="h-14 rounded-xl bg-muted animate-pulse" />
      <div class="h-14 rounded-xl bg-muted animate-pulse" />
      <div class="h-14 rounded-xl bg-muted animate-pulse" />
      <div class="sr-only">
        <ScanLine />
        Loading devices
      </div>
    </div>
  );
}

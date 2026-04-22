/**
 * TapToAddModal — the Scan Tag modal shell.
 *
 * Delegates state to `useScanTag`; the island only renders the current
 * state and wires keyboard / focus affordances. The `onTagDetected`
 * legacy prop is preserved so the existing `islands/linking/TagPicker.tsx`
 * call site keeps working; new callers should use `onDetected(result)`
 * instead.
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
import { cn } from "@/src/lib/utils/cn.ts";
import {
  type ScanResult,
  type ScanTagState,
  useScanTag,
} from "@/islands/shared/use-scan-tag.ts";
import { ScanStateIcon } from "@/components/scan/ScanStateIcon.tsx";
import { ScanCountdownRing } from "@/components/scan/ScanCountdownRing.tsx";
import { ManualEntryForm } from "@/components/scan/ManualEntryForm.tsx";
import { TagChip } from "@/components/tags/TagChip.tsx";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timeoutSeconds?: number;
  confirmMode?: "auto" | "manual";
  /** Default true. When false, the "Enter manually" secondary is hidden. */
  allowManualEntry?: boolean;
  /** Preferred callback; receives the full `ScanResult`. */
  onDetected?: (r: ScanResult) => void | Promise<void>;
  /**
   * LEGACY adapter — if supplied (and `onDetected` is not), called with
   * `r.idTag` on successful resolution. Retained only so the existing
   * `islands/linking/TagPicker.tsx` shape keeps compiling until the
   * Linking agent migrates. Do not add new call sites.
   */
  onTagDetected?: (idTag: string) => void;
}

/** Countdown thresholds we announce via the `aria-live` region. */
const ANNOUNCE_AT = new Set([20, 15, 10, 5, 3, 2, 1]);

export default function TapToAddModal({
  open,
  onOpenChange,
  timeoutSeconds = 20,
  confirmMode = "manual",
  allowManualEntry = true,
  onDetected,
  onTagDetected,
}: Props) {
  // Bridge the modal's onDetected contract to the hook's. The hook calls
  // this synchronously after successful scan-lookup; if neither handler is
  // supplied we fall back to the pre-refresh default routing.
  const handleDetected = async (r: ScanResult) => {
    if (onDetected) {
      await onDetected(r);
      return;
    }
    if (onTagDetected) {
      onTagDetected(r.idTag);
      return;
    }
    // Default: route to the tag page or the new-tag flow. Matches the old
    // `ScanTagAction` behavior so the modal remains drop-in.
    const dest = r.exists && typeof r.tagPk === "number"
      ? `/tags/${r.tagPk}`
      : `/tags/new?idTag=${encodeURIComponent(r.idTag)}`;
    globalThis.location.href = dest;
  };

  const hook = useScanTag({
    timeoutSeconds,
    confirmMode,
    onDetected: handleDetected,
  });

  const state = hook.state.value;
  const showManual = useSignal(false);
  const announceMessage = useSignal("");
  const lastAnnouncedRef = useRef<number | null>(null);
  const primaryCtaRef = useRef<HTMLButtonElement | null>(null);
  const retryCtaRef = useRef<HTMLButtonElement | null>(null);

  // Open / close lifecycle: calling `open()` resets the hook and kicks
  // off a fresh connect; `close()` tears everything down.
  useEffect(() => {
    if (open) {
      showManual.value = false;
      announceMessage.value = "";
      lastAnnouncedRef.current = null;
      hook.open();
    } else {
      hook.close();
    }
    // hook methods are stable — no deps warning needed
  }, [open]);

  // Countdown announcements for screen readers.
  const remainingDep = state.kind === "waiting" ? state.remaining : null;
  useEffect(() => {
    if (state.kind !== "waiting") return;
    const r = state.remaining;
    if (ANNOUNCE_AT.has(r) && lastAnnouncedRef.current !== r) {
      lastAnnouncedRef.current = r;
      announceMessage.value = `${r} seconds remaining`;
    }
  }, [remainingDep]);

  // Reset the "manual entry revealed" toggle on fundamental state jumps
  // so re-entering `waiting` from a retry doesn't show a stale form.
  useEffect(() => {
    if (state.kind === "resolving" || state.kind === "routing") {
      showManual.value = false;
    }
  }, [state.kind]);

  // Dialog-level key handling. Enter confirms on detected; `r` retries on
  // recoverable errors (but only when focus isn't inside a text input).
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

  // Focus management: primary CTA on `detected`, retry on errors, Close
  // (dialog default) on connecting/waiting/resolving/routing.
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

  const showBeam = state.kind === "waiting" || state.kind === "detected";

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
          role="status"
          aria-live="polite"
          aria-atomic="true"
          class="flex flex-col items-center gap-4 py-4 min-h-[300px]"
        >
          <BlurFade key={state.kind} duration={0.18}>
            <StateBody
              state={state}
              showManual={showManual.value}
              onToggleManual={() => (showManual.value = !showManual.value)}
              allowManualEntry={allowManualEntry}
              confirmMode={confirmMode}
              prefersReducedMotion={hook.prefersReducedMotion}
              onConfirm={hook.confirm}
              onCancel={hook.cancel}
              onExtend={hook.extend}
              onRetry={hook.retry}
              onManualSubmit={(v) => hook.submitManual(v)}
              onClose={handleClose}
              primaryCtaRef={primaryCtaRef}
              retryCtaRef={retryCtaRef}
            />
          </BlurFade>
        </div>

        {/* sr-only live region dedicated to countdown announcements. */}
        <span class="sr-only" aria-live="polite" aria-atomic="true">
          {announceMessage.value}
        </span>

        {showBeam && (
          <BorderBeam
            size={180}
            duration={8}
            colorFrom="var(--glow-cyan, #a855f7)"
            colorTo="var(--glow-green, #22d3ee)"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Per-state body
// ---------------------------------------------------------------------------

interface BodyProps {
  state: ScanTagState;
  showManual: boolean;
  onToggleManual: () => void;
  allowManualEntry: boolean;
  confirmMode: "auto" | "manual";
  prefersReducedMotion: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onExtend: () => void;
  onRetry: () => void;
  onManualSubmit: (idTag: string) => void;
  onClose: () => void;
  primaryCtaRef: { current: HTMLButtonElement | null };
  retryCtaRef: { current: HTMLButtonElement | null };
}

function StateBody(props: BodyProps) {
  const {
    state,
    showManual,
    onToggleManual,
    allowManualEntry,
    confirmMode,
    prefersReducedMotion,
    onConfirm,
    onCancel,
    onExtend,
    onRetry,
    onManualSubmit,
    onClose,
    primaryCtaRef,
    retryCtaRef,
  } = props;

  switch (state.kind) {
    case "idle":
    case "connecting":
      return (
        <>
          <ScanStateIcon state={state} />
          <p class="text-sm text-muted-foreground text-center max-w-xs">
            Connecting to charger log stream…
          </p>
          <div class="flex items-center justify-center gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </>
      );

    case "waiting": {
      const lowTime = state.remaining <= 5;
      return (
        <>
          <ScanCountdownRing
            remaining={state.remaining}
            total={Math.max(state.remaining, 1)}
            tone={lowTime ? "amber" : "violet"}
            reducedMotion={prefersReducedMotion}
          />
          <div class="flex flex-col items-center gap-1 text-center">
            <p class="text-sm font-medium">
              Hold your RFID card to any charger.
            </p>
            <p class="text-xs text-muted-foreground">
              We're listening for a rejected-tag event.
            </p>
          </div>

          {lowTime && !state.extended && (
            <Button variant="ghost" size="sm" onClick={onExtend}>
              +20 seconds
            </Button>
          )}

          <div class="flex items-center justify-center gap-2 pt-2 flex-wrap">
            <Button
              ref={primaryCtaRef as unknown as never}
              variant="outline"
              size="sm"
              onClick={onClose}
            >
              Cancel
            </Button>
            {allowManualEntry && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggleManual}
                aria-expanded={showManual}
              >
                <Keyboard class="mr-1 size-4" aria-hidden="true" />
                Enter manually
              </Button>
            )}
          </div>

          {allowManualEntry && showManual && (
            <div class="w-full pt-2">
              <ManualEntryForm onSubmit={onManualSubmit} />
            </div>
          )}
        </>
      );
    }

    case "detected": {
      const auto = confirmMode === "auto";
      return (
        <>
          <ScanStateIcon state={state} />
          <div class="flex flex-col items-center gap-2">
            <TagChip
              idTag={state.idTag}
              tagPk={0}
              tagType={undefined}
              href={null}
            />
            <p class="text-xs text-muted-foreground">
              {auto
                ? "Opening in 0.8s… (cancel to scan another)"
                : "Looking up…"}
            </p>
          </div>

          <div class="flex items-center justify-center gap-2 pt-2 flex-wrap">
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
          </div>
        </>
      );
    }

    case "resolving":
      return (
        <>
          <ScanStateIcon state={state} />
          <p class="text-sm text-muted-foreground text-center">
            Looking up <span class="font-mono">{state.idTag}</span>…
          </p>
        </>
      );

    case "routing":
      return (
        <>
          <ScanStateIcon state={state} />
          <p class="text-sm text-muted-foreground text-center">
            Opening{" "}
            <span class="font-mono text-foreground">{state.destination}</span>…
          </p>
          <div
            class="mt-2 h-1 w-40 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Navigating"
          >
            <div
              class={cn(
                "h-full w-1/3 bg-violet-500",
                prefersReducedMotion ? "" : "animate-pulse",
              )}
            />
          </div>
        </>
      );

    case "timeout":
      return (
        <>
          <ScanStateIcon state={state} />
          <p class="text-sm text-muted-foreground text-center max-w-xs">
            No tag detected in 20 seconds.
          </p>
          <div class="flex items-center justify-center gap-2 pt-2 flex-wrap">
            <Button
              ref={retryCtaRef as unknown as never}
              size="sm"
              onClick={onRetry}
            >
              Scan again
            </Button>
            {allowManualEntry && (
              <Button
                variant="outline"
                size="sm"
                onClick={onToggleManual}
                aria-expanded={showManual}
              >
                Enter manually
              </Button>
            )}
          </div>
          {allowManualEntry && showManual && (
            <div class="w-full pt-2">
              <ManualEntryForm onSubmit={onManualSubmit} />
            </div>
          )}
        </>
      );

    case "unavailable":
      return (
        <>
          <ScanStateIcon state={state} />
          <p class="text-sm text-destructive text-center max-w-xs">
            Charger log stream is unavailable. Is StEvE running?
          </p>
          <div class="flex items-center justify-center gap-2 pt-2 flex-wrap">
            <Button
              ref={retryCtaRef as unknown as never}
              size="sm"
              onClick={onRetry}
            >
              Retry
            </Button>
            {allowManualEntry && (
              <Button
                variant="outline"
                size="sm"
                onClick={onToggleManual}
                aria-expanded={showManual}
              >
                Enter manually
              </Button>
            )}
          </div>
          {allowManualEntry && showManual && (
            <div class="w-full pt-2">
              <ManualEntryForm onSubmit={onManualSubmit} />
            </div>
          )}
        </>
      );

    case "network_error":
      return (
        <>
          <ScanStateIcon state={state} />
          <p class="text-sm text-destructive text-center max-w-xs">
            Lost connection to detection stream.
          </p>
          <div class="flex items-center justify-center gap-2 pt-2 flex-wrap">
            <Button
              ref={retryCtaRef as unknown as never}
              size="sm"
              onClick={onRetry}
            >
              Retry
            </Button>
            {allowManualEntry && (
              <Button
                variant="outline"
                size="sm"
                onClick={onToggleManual}
                aria-expanded={showManual}
              >
                Enter manually
              </Button>
            )}
          </div>
          {allowManualEntry && showManual && (
            <div class="w-full pt-2">
              <ManualEntryForm onSubmit={onManualSubmit} />
            </div>
          )}
        </>
      );

    case "lookup_failed":
      return (
        <>
          <ScanStateIcon state={state} />
          <p class="text-sm text-destructive text-center max-w-xs">
            Couldn't look up <span class="font-mono">{state.idTag}</span>.
          </p>
          <div class="flex items-center justify-center gap-2 pt-2 flex-wrap">
            <Button
              ref={retryCtaRef as unknown as never}
              size="sm"
              onClick={() => onManualSubmit(state.idTag)}
            >
              Retry lookup
            </Button>
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
          </div>
        </>
      );

    case "dismissed":
      return null;
  }
}

/**
 * ScanPanel — canonical visual chrome for every "tap an RFID tag" flow.
 *
 * Both the customer login wizard and the admin scan-to-add / scan-to-link
 * surfaces render through this component, so the lighting, animation,
 * status pills, countdown, and error chrome stay identical across flows.
 * The only thing each caller customises is the *instructional copy* and
 * the *outcome action* shown after a match.
 *
 * Why a single visual primitive (and not just a shared hook):
 *   - "Hold tag to NFC reader" is a learned gesture; presenting it the same
 *     way to admins and customers reduces support load and keeps the chrome
 *     coherent across the product.
 *   - Per CLAUDE.md, BorderBeam is reserved for live/in-progress states;
 *     concentrating that decision here means future flows can't drift.
 *
 * State surface
 * -------------
 * Each caller maps its internal state machine (`use-scan-tag.ts` for admin,
 * `CustomerScanLoginIsland`'s inline `FlowState` for customer) onto the
 * normalised `ScanPanelState` union below. The presentational layer doesn't
 * know about endpoints, SSE streams, or pairing codes — it just renders.
 *
 * Layout
 * ------
 *   header           — title + subtitle (caller-supplied copy)
 *   body             — state-specific canonical chrome
 *   extras (slot)    — caller-owned content, e.g. the customer's charger
 *                      picker or the admin's manual-entry form
 *   actions (slot)   — caller-owned buttons (e.g. "Use email instead",
 *                      "Cancel and use email", "Open tag")
 *
 * For `state.kind === "armed"` (waiting) the body is the canonical
 * [countdown ring | numbered instructions] split — the same shape the
 * customer wizard already uses, now reused everywhere.
 */

import type { ComponentChildren } from "preact";
import { Loader2, RotateCcw } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { ScanCountdownRing } from "@/components/scan/ScanCountdownRing.tsx";
import { ScanStateIcon } from "@/components/scan/ScanStateIcon.tsx";
import type { ScanTagState } from "@/islands/shared/use-scan-tag.ts";
import { type AccentColor } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";

/**
 * Normalised view state for the panel. Each kind maps to a distinct visual
 * treatment. Callers compose their internal state machines down to one of
 * these — the panel itself is pure presentation.
 */
export type ScanPanelState =
  /** Initial / loading / connecting — single-line spinner. */
  | { kind: "idle"; message?: string }
  /** Picker / pre-arm — caller renders the body via the `extras` slot. */
  | { kind: "picker" }
  /** Live waiting state — the canonical [ring | numbered steps] layout. */
  | {
    kind: "armed";
    /** Seconds left in the pairing window; drives the ring fill. */
    remaining: number;
    /** Pairing TTL the ring's track is full at. */
    total: number;
    /** Reader display name woven into "Tap it on {name}". */
    readerName?: string | null;
    /** Override the default 3-step instruction list. */
    steps?: string[];
  }
  /** Tag detected; caller usually wants to render an outcome via children. */
  | { kind: "detected"; idTag: string; message?: string }
  /** Server-side action in flight (login, lookup, link…). */
  | { kind: "resolving"; message?: string }
  /** Terminal success — usually a redirect is happening. */
  | { kind: "success"; message?: string }
  /** Recoverable / non-recoverable error — caller drives the retry verb. */
  | {
    kind: "error";
    message: string;
    /** When set, the panel renders a "Try again" CTA wired to this fn. */
    onRetry?: () => void;
  };

interface ScanPanelProps {
  /**
   * Optional heading (e.g. "Scan to sign in", "Scan a tag to add"). Omit
   * to render the body unframed — useful when the surrounding shell
   * already supplies a title (e.g. a Dialog header, a wizard step header).
   */
  title?: string;
  /** Optional helper line under the title. */
  subtitle?: string;
  /** Drives the ring tone, the state icon's neutral tint, etc. */
  accent?: AccentColor;
  /** The current view state — see `ScanPanelState`. */
  state: ScanPanelState;
  /** Pass `true` to skip the animated countdown stroke. */
  prefersReducedMotion?: boolean;
  /**
   * Optional outcome / extras slot. Used for the customer's charger picker,
   * the admin's manual entry form, or any post-match follow-up the caller
   * wants to render *inside* the panel chrome.
   */
  children?: ComponentChildren;
  /**
   * Optional secondary content rendered below the children — typically a
   * row of action buttons ("Cancel and use email instead", "Try again").
   */
  actions?: ComponentChildren;
  /** Optional inline help text (small, muted, above the actions row). */
  helpText?: ComponentChildren;
  /** Extra classes for the outer wrapper. */
  class?: string;
}

const DEFAULT_STEPS = [
  "Wake your card",
  "Tap it on the reader",
  "We'll handle the rest",
];

/**
 * Shim that adapts a `ScanTagState` (from `use-scan-tag.ts`) onto the
 * normalised `ScanPanelState`. Centralised here so admin call sites don't
 * each re-derive the mapping.
 */
export function adaptScanTagState(
  s: ScanTagState,
  opts: { total: number; readerName?: string | null },
): ScanPanelState {
  switch (s.kind) {
    case "idle":
      return { kind: "idle", message: "Getting ready…" };
    case "connecting":
      return { kind: "idle", message: "Connecting…" };
    case "waiting":
      return {
        kind: "armed",
        remaining: s.remaining,
        total: opts.total,
        readerName: opts.readerName,
      };
    case "detected":
      return {
        kind: "detected",
        idTag: s.idTag,
        message: "Looking up…",
      };
    case "resolving":
      return { kind: "resolving", message: `Looking up ${s.idTag}…` };
    case "routing":
      return { kind: "success", message: `Opening ${s.destination}…` };
    case "timeout":
      return {
        kind: "error",
        message: "No tag detected in time. Try again to scan your card.",
      };
    case "unavailable":
      return {
        kind: "error",
        message:
          "The charger detection service is unreachable. It may be restarting — try again in a moment.",
      };
    case "network_error":
      return {
        kind: "error",
        message: "Lost connection to the detection stream. Try again.",
      };
    case "lookup_failed":
      return {
        kind: "error",
        message: `Couldn't look up ${s.idTag}.`,
      };
    case "cancelled":
      return {
        kind: "error",
        message:
          "Scan was cancelled on the device. Try again to scan your card.",
      };
    case "dismissed":
      return { kind: "idle" };
  }
}

/**
 * The canonical panel. All the visual decisions (icon, ring, layout) live
 * here so the customer and admin flows stay 1:1 in feel.
 */
export function ScanPanel({
  title,
  subtitle,
  accent = "cyan",
  state,
  prefersReducedMotion = false,
  children,
  actions,
  helpText,
  class: className,
}: ScanPanelProps) {
  return (
    <section class={cn("flex flex-col gap-4", className)}>
      {(title || subtitle) && (
        <header class="flex flex-col gap-1">
          {title && (
            <h3 class="text-base font-semibold leading-tight text-foreground">
              {title}
            </h3>
          )}
          {subtitle && (
            <p class="text-xs text-muted-foreground leading-snug">{subtitle}</p>
          )}
        </header>
      )}

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        class="flex flex-col gap-4"
      >
        <Body
          state={state}
          accent={accent}
          prefersReducedMotion={prefersReducedMotion}
        />
      </div>

      {children}

      {helpText && (
        <p class="text-[11px] text-center text-muted-foreground">{helpText}</p>
      )}

      {actions && (
        <div class="flex flex-wrap items-center justify-center gap-2">
          {actions}
        </div>
      )}
    </section>
  );
}

function Body({
  state,
  accent,
  prefersReducedMotion,
}: {
  state: ScanPanelState;
  accent: AccentColor;
  prefersReducedMotion: boolean;
}) {
  switch (state.kind) {
    case "idle":
      return (
        <div class="flex flex-col items-center gap-2 py-6 text-center">
          <Loader2 class="size-6 animate-spin text-muted-foreground" />
          <p class="text-sm text-muted-foreground">
            {state.message ?? "Getting ready…"}
          </p>
        </div>
      );

    case "picker":
      // Caller renders the picker via children; we just provide framing.
      return null;

    case "armed": {
      const lowTime = state.remaining <= Math.max(5, state.total * 0.2);
      const tone: AccentColor = lowTime ? "amber" : accent;
      const reader = state.readerName?.trim() ? state.readerName : "the reader";
      const steps = state.steps ?? [
        "Wake your card",
        `Tap it on ${reader}`,
        DEFAULT_STEPS[2],
      ];
      return (
        <div class="flex items-stretch gap-4">
          <div class="shrink-0 rounded-xl border bg-card/60 p-4 sm:p-5 flex items-center justify-center">
            <ScanCountdownRing
              remaining={state.remaining}
              total={Math.max(state.total, 1)}
              tone={tone}
              reducedMotion={prefersReducedMotion}
            />
          </div>
          <ol class="min-w-0 flex-1 flex flex-col justify-center gap-2 py-1">
            {steps.map((step, i) => (
              <li key={i} class="flex items-baseline gap-2">
                <span
                  class="text-xs font-mono tabular-nums text-muted-foreground/60 shrink-0"
                  aria-hidden="true"
                >
                  {i + 1}.
                </span>
                <span class="text-sm leading-snug">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      );
    }

    case "detected":
      return (
        <div class="flex flex-col items-center gap-3 py-2 text-center">
          <ScanStateIcon
            state={{ kind: "detected", idTag: state.idTag, remaining: 0 }}
            accent={accent}
          />
          <p class="text-sm font-medium text-foreground">
            Detected{" "}
            <span class="font-mono text-foreground">{state.idTag}</span>
          </p>
          {state.message && (
            <p class="text-xs text-muted-foreground">{state.message}</p>
          )}
        </div>
      );

    case "resolving":
      return (
        <div class="flex flex-col items-center gap-2 py-6 text-center">
          <Loader2 class="size-6 animate-spin text-primary" />
          <p class="text-sm text-muted-foreground">
            {state.message ?? "Looking up…"}
          </p>
        </div>
      );

    case "success":
      return (
        <div class="flex flex-col items-center gap-2 py-6 text-center">
          <Loader2 class="size-6 animate-spin text-primary" />
          <p class="text-sm font-medium text-foreground">
            {state.message ?? "Done. Redirecting…"}
          </p>
        </div>
      );

    case "error":
      return (
        <div class="flex flex-col items-center gap-3 py-4 text-center">
          <ScanStateIcon
            state={{ kind: "network_error", phase: "stream" }}
            accent={accent}
          />
          <p class="text-sm text-destructive max-w-xs">{state.message}</p>
          {state.onRetry && (
            <Button variant="outline" size="sm" onClick={state.onRetry}>
              <RotateCcw class="mr-1 size-3.5" />
              Try again
            </Button>
          )}
        </div>
      );
  }
}

/**
 * Returns true while the panel is in a live / in-progress state — used by
 * callers to decide whether to render the BorderBeam (per CLAUDE.md, beam is
 * reserved for live/in-progress semantics, never decorative).
 */
export function shouldRenderBeam(state: ScanPanelState): boolean {
  return state.kind === "armed" || state.kind === "detected" ||
    state.kind === "resolving";
}

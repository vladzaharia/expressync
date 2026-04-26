/**
 * Polaris Track E — customer scan-to-login flow (interactive island).
 *
 * State machine:
 *
 *   idle → loadingChargers → ready (1 charger auto-paired)
 *                          → picker (N>1 chargers)
 *                          → noChargers (N=0)
 *
 *   picker → pairing → waiting → detected → loggingIn → success(redirect)
 *
 *   waiting → timeout (90s elapsed) → retry available
 *           → error (network / SSE)  → retry available
 *           → escape: "or sign in with email" closes the modal so the
 *             outer login page's email form is visible again.
 *
 * Flow:
 *   1. Open dialog: GET /api/auth/scan-tap-targets
 *   2. Auto-pair if exactly one charger is online; else render
 *      `DevicePickerInline` for selection. Customers don't own phones in
 *      v1 so the picker only ever shows charger rows on this surface,
 *      which means `isOwnDevice` is never true and the auto-pick won't
 *      accidentally fire for "first online charger I happen to be near."
 *   3. POST /api/auth/scan-pair with { chargeBoxId } → { pairingCode, ... }
 *   4. Render PairingCodeDisplay + open EventSource for scan-detect.
 *   5. On `tag-detected` event, POST /api/auth/scan-login with the payload.
 *   6. On 200 → navigate to redirectTo (cookie already set).
 *   7. On error/timeout → show retry + email escape hatch.
 *
 * Cleanup is unconditional: any state transition that leaves `waiting`
 * cancels outstanding timers and closes the EventSource. The mount-scope
 * cleanup also fires on unmount so a rapid dialog toggle doesn't leak SSE
 * connections.
 */

import { useEffect, useMemo, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { DevicePickerInline } from "@/components/scan/DevicePickerInline.tsx";
import { ScanCountdownRing } from "@/components/scan/ScanCountdownRing.tsx";
import {
  ScanPanel,
  type ScanPanelState,
} from "@/components/scan/ScanPanel.tsx";
import {
  AlertCircle,
  Loader2,
  RotateCcw,
  ScanLine,
  WifiOff,
} from "lucide-preact";
import { clientNavigate } from "@/src/lib/nav.ts";
import type { TapTargetEntry } from "@/src/lib/types/devices.ts";

type FlowState =
  | { kind: "idle" }
  | { kind: "loadingChargers" }
  | { kind: "noChargers" }
  | { kind: "picker"; targets: TapTargetEntry[] }
  | { kind: "pairing"; chargeBoxId: string; chargerName: string | null }
  | {
    kind: "waiting";
    chargeBoxId: string;
    chargerName: string | null;
    pairingCode: string;
    expiresAt: number;
    secondsRemaining: number;
  }
  | { kind: "loggingIn" }
  | { kind: "success"; redirectTo: string }
  | {
    kind: "error";
    message: string;
    canRetry: boolean;
  };

interface ScanDetectEvent {
  idTag: string;
  nonce: string;
  t: number;
}

/**
 * Wave 4 D3: response shape from `/api/auth/scan-tap-targets`. The
 * customer scan-login flow only acts on charger targets — customers
 * don't own phones in v1 (the iOS app is admin-only) — so the picker
 * naturally only renders charger rows. We still use the unified
 * `TapTargetEntry` contract end-to-end so any future expansion (kiosk
 * NFC, etc.) drops in without another picker swap.
 */
interface TapTargetsResponse {
  devices?: TapTargetEntry[];
}

interface PairResponse {
  pairingCode?: string;
  chargeBoxId?: string;
  expiresInSec?: number;
  error?: string;
}

interface LoginResponse {
  redirectTo?: string;
  error?: string;
}

const PAIRING_DEFAULT_TTL_SEC = 90;

function pickChargerName(c: TapTargetEntry): string {
  return c.label?.trim() || c.deviceId;
}

function readPrefersReducedMotion(): boolean {
  if (typeof globalThis === "undefined") return false;
  const mm = (globalThis as unknown as {
    matchMedia?: (q: string) => { matches: boolean };
  }).matchMedia;
  if (typeof mm !== "function") return false;
  try {
    return mm("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

interface CustomerScanLoginIslandProps {
  /**
   * When `true`, the modal opens automatically on mount. Used by the
   * `/auth/scan` deep-link path (`?scan=1`) so QR-code arrivals jump
   * straight into the flow.
   */
  autoOpen?: boolean;
  /**
   * Optional pre-selected chargeBoxId from `?chargeBoxId=` deep link.
   * The flow still calls `/api/auth/scan-pair` to validate it; if the
   * server rejects it, the picker falls back as usual.
   */
  initialChargeBoxId?: string | null;
  /** Optional CSS class for the trigger button. */
  className?: string;
  /**
   * Inline mode (wizard step 2): render the flow body directly instead of
   * behind a trigger button + Dialog. Begins loading on mount and surfaces
   * `onExit` when the user cancels — the wizard shell uses that to return
   * to the method picker.
   */
  inline?: boolean;
  /** Only used when `inline`; fires when the user chooses to back out. */
  onExit?: () => void;
}

export default function CustomerScanLoginIsland({
  autoOpen = false,
  initialChargeBoxId = null,
  className,
  inline = false,
  onExit,
}: CustomerScanLoginIslandProps) {
  const open = useSignal(false);
  const flow = useSignal<FlowState>({ kind: "idle" });
  const prefersReducedMotion = useMemo(readPrefersReducedMotion, []);

  // Side-effect handles. Kept in a ref so transitions can reach them
  // without re-creating the island API across renders.
  const refs = useRef({
    eventSource: null as EventSource | null,
    countdown: null as ReturnType<typeof setInterval> | null,
    sessionId: 0,
  });

  const closeEventSource = (): void => {
    if (refs.current.eventSource) {
      try {
        refs.current.eventSource.close();
      } catch { /* already closed */ }
      refs.current.eventSource = null;
    }
  };

  const clearCountdown = (): void => {
    if (refs.current.countdown !== null) {
      clearInterval(refs.current.countdown);
      refs.current.countdown = null;
    }
  };

  const cleanup = (): void => {
    closeEventSource();
    clearCountdown();
  };

  // Best-effort release of an armed pairing. Fired when the user cancels
  // out of the waiting step so the charger doesn't stay "listening" for a
  // tap for the remainder of the 90s TTL (and so the next attempt isn't
  // blocked by the "already_armed_for_charger" guard).
  const releasePairingIfArmed = (): void => {
    const cur = flow.value;
    if (cur.kind !== "waiting") return;
    // `keepalive` so the beacon completes even if the page is mid-navigation;
    // fire-and-forget — any failure is silently absorbed (TTL handles the
    // worst case).
    try {
      void fetch("/api/auth/scan-pair", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chargeBoxId: cur.chargeBoxId,
          pairingCode: cur.pairingCode,
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* noop */
    }
  };

  // Handle the dialog closing (backdrop click, X button, or Escape key).
  const handleClose = (): void => {
    cleanup();
    refs.current.sessionId++;
    open.value = false;
    flow.value = { kind: "idle" };
  };

  // Reset to "loadingChargers" and re-fetch the picker list. Used by the
  // "Try again" buttons in error/timeout states.
  const beginLoadChargers = async (): Promise<void> => {
    cleanup();
    const mySession = ++refs.current.sessionId;
    flow.value = { kind: "loadingChargers" };

    let resp: Response;
    try {
      resp = await fetch("/api/auth/scan-tap-targets", {
        headers: { Accept: "application/json" },
      });
    } catch {
      if (mySession !== refs.current.sessionId) return;
      flow.value = {
        kind: "error",
        message: "Couldn't reach the charger list. Check your connection.",
        canRetry: true,
      };
      return;
    }
    if (mySession !== refs.current.sessionId) return;

    if (resp.status === 503) {
      flow.value = {
        kind: "error",
        message:
          "Scan-to-sign-in is temporarily unavailable. Use the email option instead.",
        canRetry: false,
      };
      return;
    }
    if (!resp.ok) {
      flow.value = {
        kind: "error",
        message: "Couldn't load chargers. Try again in a moment.",
        canRetry: true,
      };
      return;
    }
    const body: TapTargetsResponse = await resp.json().catch(() => ({}));
    // Customers don't own phones in v1 — the iOS app is admin-only — so
    // the response contains chargers only. We still filter explicitly so
    // any future server-side widening doesn't accidentally surface an
    // unowned phone as a customer login target.
    const chargers: TapTargetEntry[] = (body.devices ?? []).filter(
      (d) => d.pairableType === "charger",
    );
    const online = chargers.filter((c) => c.isOnline);

    if (online.length === 0) {
      flow.value = { kind: "noChargers" };
      return;
    }

    // If a deep-link suggested chargeBoxId, prefer it when present in the list.
    const deepCharger = initialChargeBoxId
      ? online.find((c) => c.deviceId === initialChargeBoxId)
      : undefined;
    if (deepCharger) {
      await beginPair(deepCharger.deviceId, pickChargerName(deepCharger));
      return;
    }

    if (online.length === 1) {
      await beginPair(online[0].deviceId, pickChargerName(online[0]));
      return;
    }
    // Pass the full charger list (including offline rows) so the picker
    // can surface them grayed-out per the design.
    flow.value = { kind: "picker", targets: chargers };
  };

  // Pair against a specific charger and arm the SSE stream.
  const beginPair = async (
    chargeBoxId: string,
    chargerName: string | null,
  ): Promise<void> => {
    cleanup();
    const mySession = ++refs.current.sessionId;
    flow.value = { kind: "pairing", chargeBoxId, chargerName };

    let resp: Response;
    try {
      resp = await fetch("/api/auth/scan-pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chargeBoxId }),
      });
    } catch {
      if (mySession !== refs.current.sessionId) return;
      flow.value = {
        kind: "error",
        message: "Couldn't arm the pairing. Check your connection.",
        canRetry: true,
      };
      return;
    }
    if (mySession !== refs.current.sessionId) return;

    const body: PairResponse = await resp.json().catch(() => ({}));
    if (!resp.ok || !body.pairingCode || !body.chargeBoxId) {
      const msg = resp.status === 409
        ? "Another sign-in is already pending on this charger. Wait a minute and try again."
        : resp.status === 429
        ? "Too many sign-in attempts. Wait a minute and try again."
        : resp.status === 503
        ? "Scan-to-sign-in is temporarily unavailable."
        : "Couldn't start the pairing. Try again.";
      flow.value = {
        kind: "error",
        message: msg,
        canRetry: resp.status !== 503,
      };
      return;
    }

    const ttl = typeof body.expiresInSec === "number"
      ? body.expiresInSec
      : PAIRING_DEFAULT_TTL_SEC;
    const expiresAt = Date.now() + ttl * 1000;

    flow.value = {
      kind: "waiting",
      chargeBoxId: body.chargeBoxId,
      chargerName,
      pairingCode: body.pairingCode,
      expiresAt,
      secondsRemaining: ttl,
    };

    // Start the countdown. We tick once per second; the SSE stream is the
    // authority for "succeeded" / "timeout" — this is just for the UI.
    clearCountdown();
    refs.current.countdown = setInterval(() => {
      if (mySession !== refs.current.sessionId) return;
      const cur = flow.value;
      if (cur.kind !== "waiting") return;
      const secondsRemaining = Math.max(
        0,
        Math.ceil((cur.expiresAt - Date.now()) / 1000),
      );
      if (secondsRemaining <= 0) {
        cleanup();
        flow.value = {
          kind: "error",
          message: "The pairing window expired. Try again to scan your card.",
          canRetry: true,
        };
        return;
      }
      flow.value = { ...cur, secondsRemaining };
    }, 1000);

    // Open the SSE stream for tag detection.
    const url = `/api/auth/scan-detect?pairingCode=${
      encodeURIComponent(body.pairingCode)
    }&chargeBoxId=${encodeURIComponent(body.chargeBoxId)}`;
    let es: EventSource;
    try {
      es = new EventSource(url);
    } catch {
      if (mySession !== refs.current.sessionId) return;
      cleanup();
      flow.value = {
        kind: "error",
        message: "Couldn't open the detection stream. Try again.",
        canRetry: true,
      };
      return;
    }
    refs.current.eventSource = es;

    // Generic message handler — scan-detect emits anonymous (no event:
    // line) data events for `tag-detected`.
    es.onmessage = (event: MessageEvent) => {
      if (mySession !== refs.current.sessionId) return;
      let payload: ScanDetectEvent | null = null;
      try {
        payload = JSON.parse(event.data) as ScanDetectEvent;
      } catch {
        payload = null;
      }
      if (!payload || !payload.idTag || !payload.nonce) return;
      void completeLogin(
        body.pairingCode!,
        body.chargeBoxId!,
        payload,
        mySession,
      );
    };

    es.addEventListener("error", () => {
      if (mySession !== refs.current.sessionId) return;
      // Underlying EventSource errors include normal reconnect attempts;
      // we only treat it as fatal if the readyState is CLOSED (2).
      if (refs.current.eventSource?.readyState === 2) {
        cleanup();
        flow.value = {
          kind: "error",
          message: "Lost connection to the detection stream. Try again.",
          canRetry: true,
        };
      }
    });

    es.addEventListener("timeout", () => {
      if (mySession !== refs.current.sessionId) return;
      cleanup();
      flow.value = {
        kind: "error",
        message: "We didn't see a tap in time. Try again to scan your card.",
        canRetry: true,
      };
    });
  };

  const completeLogin = async (
    pairingCode: string,
    chargeBoxId: string,
    detected: ScanDetectEvent,
    mySession: number,
  ): Promise<void> => {
    if (mySession !== refs.current.sessionId) return;
    cleanup();
    flow.value = { kind: "loggingIn" };

    let resp: Response;
    try {
      resp = await fetch("/api/auth/scan-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairingCode,
          chargeBoxId,
          idTag: detected.idTag,
          nonce: detected.nonce,
          t: detected.t,
        }),
      });
    } catch {
      if (mySession !== refs.current.sessionId) return;
      flow.value = {
        kind: "error",
        message: "Couldn't finish signing you in. Try again.",
        canRetry: true,
      };
      return;
    }
    if (mySession !== refs.current.sessionId) return;

    const body: LoginResponse = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = resp.status === 401
        ? "That card isn't linked to a customer account. Contact your operator."
        : resp.status === 410
        ? "This pairing was already used. Try again to scan your card."
        : resp.status === 403
        ? "Couldn't verify your scan. Try again."
        : "Couldn't sign you in. Try again or use the email option.";
      flow.value = { kind: "error", message: msg, canRetry: true };
      return;
    }

    const redirectTo = typeof body.redirectTo === "string"
      ? body.redirectTo
      : "/";
    flow.value = { kind: "success", redirectTo };
    // Cookie is already set by the response. Navigate (replace so back
    // button doesn't bounce to the login page).
    try {
      globalThis.location.replace(redirectTo);
    } catch {
      // Fallback for environments where replace isn't available.
      clientNavigate(redirectTo);
    }
  };

  const handleOpen = (): void => {
    open.value = true;
    void beginLoadChargers();
  };

  // Auto-start triggers:
  //   - `autoOpen` deep-link (?scan=1) opens the modal immediately
  //   - `inline` mode begins loading the picker immediately so the wizard
  //     doesn't require a second click to start looking for chargers.
  useEffect(() => {
    if (inline) {
      void beginLoadChargers();
    }
    // Listen for an external release signal (the wizard's Back pill fires
    // this synchronously before the scan island unmounts). Relying on the
    // unmount-cleanup fetch alone was unreliable — `keepalive: true` on
    // fetch doesn't always survive a SPA-style remount, so a proactive
    // release via a document-level event is the safer path.
    const onReleaseSignal = () => releasePairingIfArmed();
    if (inline && typeof globalThis !== "undefined") {
      globalThis.addEventListener("scan:release", onReleaseSignal);
    }
    if (!inline && autoOpen) {
      handleOpen();
    }
    return () => {
      if (inline && typeof globalThis !== "undefined") {
        globalThis.removeEventListener("scan:release", onReleaseSignal);
      }
      releasePairingIfArmed();
      cleanup();
      refs.current.sessionId++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Inline render: no trigger, no Dialog. The wizard's step container owns
  // the chrome; we just render the body + a Back / Cancel affordance.
  if (inline) {
    return (
      <InlineFlow
        flow={flow.value}
        prefersReducedMotion={prefersReducedMotion}
        onPickCharger={(c) => beginPair(c, null)}
        onRetry={() => void beginLoadChargers()}
        onExit={() => {
          releasePairingIfArmed();
          cleanup();
          refs.current.sessionId++;
          flow.value = { kind: "idle" };
          onExit?.();
        }}
      />
    );
  }

  // Modal render (legacy deep-link path). Trigger button opens the Dialog.
  return (
    <>
      <Button
        type="button"
        size="lg"
        className={`w-full h-12 text-base font-semibold bg-sky-600 text-white hover:bg-sky-500 dark:bg-sky-500 dark:hover:bg-sky-400 ${
          className ?? ""
        }`}
        onClick={handleOpen}
      >
        <ScanLine class="mr-2 size-5" />
        Tap to scan your card
      </Button>

      <Dialog
        open={open.value}
        onOpenChange={(v) => (v ? null : handleClose())}
      >
        <DialogContent
          onClose={handleClose}
          class="max-w-md sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle>Scan to sign in</DialogTitle>
            <DialogDescription>
              Tap your charging card on the reader to sign in.
            </DialogDescription>
          </DialogHeader>
          <div class="mt-2">
            <FlowBody
              flow={flow.value}
              prefersReducedMotion={prefersReducedMotion}
              onPickCharger={(c) => beginPair(c, null)}
              onRetry={() => void beginLoadChargers()}
              onClose={handleClose}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Inline flow body — the wizard version with side-by-side countdown ring +
// instructions. Renders through `ScanPanel` (the canonical chrome shared
// with admin scan flows) so the look stays identical across surfaces.
function InlineFlow({
  flow,
  prefersReducedMotion,
  onPickCharger,
  onRetry,
  onExit: _onExit,
}: {
  flow: FlowState;
  prefersReducedMotion: boolean;
  onPickCharger: (chargeBoxId: string) => void;
  onRetry: () => void;
  onExit: () => void;
}) {
  // The "no chargers" terminal state reuses the panel's error chrome with a
  // disambiguating icon. We let ScanPanel's error case render the framing.
  if (flow.kind === "noChargers") {
    return (
      <ScanPanel
        accent="cyan"
        prefersReducedMotion={prefersReducedMotion}
        state={{
          kind: "error",
          message:
            "We couldn't reach a reader right now. Use email instead or try again in a minute.",
          onRetry,
        }}
      />
    );
  }

  if (flow.kind === "picker") {
    return (
      <div class="space-y-3">
        <p class="text-xs text-muted-foreground">Which reader are you at?</p>
        <DevicePickerInline
          devices={flow.targets}
          selectedDeviceId={null}
          onSelect={(target) => onPickCharger(target.deviceId)}
        />
      </div>
    );
  }

  const panelState = mapCustomerFlowToPanelState(flow);
  return (
    <ScanPanel
      accent="cyan"
      prefersReducedMotion={prefersReducedMotion}
      state={panelState.kind === "error"
        ? {
          ...panelState,
          onRetry: flow.kind === "error" && flow.canRetry ? onRetry : undefined,
        }
        : panelState}
    />
  );
}

/**
 * Map the customer's internal `FlowState` to the normalised `ScanPanelState`.
 * Kept inline so the customer-specific copy ("Signing you in…", etc.) stays
 * with the customer flow.
 */
function mapCustomerFlowToPanelState(flow: FlowState): ScanPanelState {
  switch (flow.kind) {
    case "idle":
    case "loadingChargers":
      return { kind: "idle", message: "Looking for your chargers…" };
    case "pairing":
      return { kind: "idle", message: "Arming the reader…" };
    case "waiting":
      return {
        kind: "armed",
        remaining: flow.secondsRemaining,
        total: PAIRING_DEFAULT_TTL_SEC,
        readerName: flow.chargerName,
        steps: [
          "Wake your card",
          `Tap it on ${
            flow.chargerName?.trim() ? flow.chargerName : "the reader"
          }`,
          "Login, just like that!",
        ],
      };
    case "loggingIn":
      return { kind: "resolving", message: "Signing you in…" };
    case "success":
      return { kind: "success", message: "Signed in. Redirecting…" };
    case "error":
      return { kind: "error", message: flow.message };
    // picker / noChargers handled by callers above.
    default:
      return { kind: "idle" };
  }
}

function FlowBody({
  flow,
  prefersReducedMotion,
  onPickCharger,
  onRetry,
  onClose,
}: {
  flow: FlowState;
  prefersReducedMotion: boolean;
  onPickCharger: (chargeBoxId: string) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  if (flow.kind === "idle" || flow.kind === "loadingChargers") {
    return (
      <div class="flex flex-col items-center gap-2 py-6 text-center">
        <Loader2 class="size-6 animate-spin text-muted-foreground" />
        <p class="text-sm text-muted-foreground">
          Looking for your chargers…
        </p>
      </div>
    );
  }

  if (flow.kind === "noChargers") {
    return (
      <div class="space-y-3 text-center">
        <WifiOff
          class="size-8 mx-auto text-muted-foreground"
          aria-hidden="true"
        />
        <p class="text-sm font-medium text-foreground">
          No chargers online
        </p>
        <p class="text-xs text-muted-foreground">
          We couldn't find an online charger to pair with. Contact your operator
          if this looks wrong.
        </p>
        <div class="flex gap-2 justify-center">
          <Button variant="outline" size="sm" onClick={onRetry}>
            Refresh
          </Button>
          <Button size="sm" onClick={onClose}>Use email instead</Button>
        </div>
      </div>
    );
  }

  if (flow.kind === "picker") {
    return (
      <div class="space-y-3">
        <p class="text-xs text-muted-foreground">
          Pick the charger you're going to tap your card on:
        </p>
        <DevicePickerInline
          devices={flow.targets}
          selectedDeviceId={null}
          onSelect={(target) => onPickCharger(target.deviceId)}
        />
      </div>
    );
  }

  if (flow.kind === "pairing") {
    return (
      <div class="flex flex-col items-center gap-2 py-6 text-center">
        <Loader2 class="size-6 animate-spin text-muted-foreground" />
        <p class="text-sm text-muted-foreground">
          Arming{" "}
          <span class="font-medium text-foreground">
            {flow.chargerName ?? flow.chargeBoxId}
          </span>…
        </p>
      </div>
    );
  }

  if (flow.kind === "waiting") {
    const name = flow.chargerName?.trim() ? flow.chargerName : "the reader";
    const tone = flow.secondsRemaining <= 15 ? "amber" : "cyan";
    return (
      <div class="space-y-4">
        <div class="flex flex-col items-center gap-3 py-2">
          <ScanCountdownRing
            remaining={flow.secondsRemaining}
            total={PAIRING_DEFAULT_TTL_SEC}
            tone={tone}
            reducedMotion={prefersReducedMotion}
          />
          <p class="text-sm text-center">
            Hold your RFID card against{" "}
            <span class="font-semibold text-foreground">{name}</span>.
          </p>
        </div>
        <p class="text-xs text-center text-muted-foreground">
          We'll sign you in the moment it's detected.
        </p>
        <div class="flex justify-center">
          <button
            type="button"
            class="text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={onClose}
          >
            Cancel and use email instead
          </button>
        </div>
      </div>
    );
  }

  if (flow.kind === "loggingIn") {
    return (
      <div class="flex flex-col items-center gap-2 py-6 text-center">
        <Loader2 class="size-6 animate-spin text-primary" />
        <p class="text-sm font-medium text-foreground">Signing you in…</p>
      </div>
    );
  }

  if (flow.kind === "success") {
    return (
      <div class="flex flex-col items-center gap-2 py-6 text-center">
        <Loader2 class="size-6 animate-spin text-primary" />
        <p class="text-sm font-medium text-foreground">
          Signed in. Redirecting…
        </p>
      </div>
    );
  }

  // error
  return (
    <div class="space-y-3 text-center">
      <AlertCircle
        class="size-8 mx-auto text-destructive"
        aria-hidden="true"
      />
      <p class="text-sm text-foreground">{flow.message}</p>
      <div class="flex gap-2 justify-center">
        {flow.canRetry
          ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw class="mr-1 size-3.5" />
              Try again
            </Button>
          )
          : null}
        <Button size="sm" onClick={onClose}>Use email instead</Button>
      </div>
    </div>
  );
}

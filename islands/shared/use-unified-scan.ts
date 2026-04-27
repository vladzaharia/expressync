/**
 * useUnifiedScan — single state machine for the unified Scan Tag flow.
 *
 * Replaces both `islands/shared/use-scan-tag.ts` (admin) and the inline
 * state machine in `islands/customer/CustomerScanLoginIsland.tsx`. One
 * hook, three modes:
 *
 *   - mode="admin", purpose="add-tag"     → arms via /api/admin/{...}/scan-arm,
 *                                            POSTs scan-lookup on detect, hands
 *                                            ScanResult to caller.
 *   - mode="admin", purpose="lookup-tag"  → same arm path; ScanResult is
 *                                            handed to caller for routing.
 *   - mode="customer", purpose="login"    → arms via /api/auth/scan-pair (charger
 *                                            only for now), completes via
 *                                            /api/auth/scan-login, redirects.
 *
 * Phase model: picker | armed | result. The hook never owns picker UI —
 * it loads the roster (`tapTargets`), the caller renders the rows. When
 * the caller calls `selectTarget(t)` the hook transitions into `armed`,
 * fires the arm POST, opens the SSE stream, and counts down. From `armed`
 * we transition to `result` on detect / cancel / timeout / error.
 */

import { type Signal, signal } from "@preact/signals";
import { useEffect, useMemo } from "preact/hooks";
import type { TapTargetEntry } from "@/src/lib/types/devices.ts";

export type ScanMode = "admin" | "customer";
export type ScanPurpose = "add-tag" | "lookup-tag" | "login";

export interface ScanResult {
  idTag: string;
  exists: boolean;
  tagPk?: number;
  hasMapping?: boolean;
  mappingId?: number | null;
}

/**
 * What the caller wants to happen when the scan resolves. For admin
 * flows the caller usually wants the ScanResult (route or callback). For
 * customer login the hook drives the completion itself (POST scan-login,
 * then redirect).
 */
export type ResolveStrategy =
  | { kind: "route"; build: (r: ScanResult) => string }
  | { kind: "callback"; fn: (r: ScanResult) => void | Promise<void> }
  | { kind: "customer-login" };

export type ScanFlowState =
  | { kind: "idle" }
  | { kind: "loadingTargets" }
  | { kind: "picker"; targets: TapTargetEntry[] }
  | { kind: "noTargets" }
  | {
    kind: "arming";
    target: TapTargetEntry;
  }
  | {
    kind: "armed";
    target: TapTargetEntry;
    pairingCode: string;
    expiresAtEpochMs: number;
    remaining: number;
  }
  | {
    kind: "detected";
    target: TapTargetEntry;
    idTag: string;
    nonce?: string;
    nonceTimestamp?: number;
    pairingCode: string;
  }
  | { kind: "resolving"; idTag: string }
  | { kind: "success"; message?: string }
  | {
    kind: "error";
    message: string;
    canRetry: boolean;
    /** When true, retry returns to picker; when false, retry rearms same target. */
    backToPicker: boolean;
  };

export interface UseUnifiedScanOptions {
  mode: ScanMode;
  purpose: ScanPurpose;
  /** Strategy for terminal resolution. Required. */
  resolve: ResolveStrategy;
  /**
   * Pre-selected target. When set, the hook skips the picker entirely and
   * arms this target immediately on `start()`. Used by entry points that
   * already know which device to scan (e.g. device-detail "Trigger scan").
   */
  preselected?: TapTargetEntry;
  /**
   * Pre-selected target id, used when caller has only an id (not a full
   * TapTargetEntry). The hook fetches the roster, finds the matching
   * entry, and arms it. Falls back to picker if the entry isn't online
   * or doesn't exist.
   */
  preselectedId?: { deviceId: string; pairableType: "device" | "charger" };
  /** Optional pairing TTL in seconds; defaults to 90 (matches server). */
  ttlSeconds?: number;
  /** Free-text shown in the iOS push for device-mode scans. */
  hintLabel?: string | null;
}

export interface UseUnifiedScanApi {
  state: Signal<ScanFlowState>;
  prefersReducedMotion: boolean;
  /** Begin: load targets (or arm preselected). Idempotent. */
  start: () => void;
  /** Pick a target from the picker phase. */
  selectTarget: (t: TapTargetEntry) => void;
  /** Return to picker from any later phase, cancelling the active arm. */
  backToPicker: () => void;
  /** Retry from an error / timeout. Behaviour depends on `backToPicker` flag. */
  retry: () => void;
  /** Complete the scan with a manually-typed idTag (admin only). */
  submitManual: (idTag: string) => void;
  /** Tear down everything and reset to idle. Awaits the cancel DELETE. */
  shutdown: () => Promise<void>;
}

const PAIRING_DEFAULT_TTL_SEC = 90;

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

interface ScanDetectEvent {
  idTag: string;
  nonce?: string;
  t?: number;
}

interface ArmResponse {
  pairingCode?: string;
  expiresInSec?: number;
  expiresAtEpochMs?: number;
  chargeBoxId?: string;
  deviceId?: string;
  error?: string;
}

interface ActiveArm {
  pairableType: "charger" | "device";
  pairingCode: string;
  deviceId: string; // chargeBoxId for charger; UUID for device
  mode: ScanMode;
}

export function useUnifiedScan(opts: UseUnifiedScanOptions): UseUnifiedScanApi {
  const ttlSeconds = Math.max(1, opts.ttlSeconds ?? PAIRING_DEFAULT_TTL_SEC);

  const state = useMemo<Signal<ScanFlowState>>(
    () => signal<ScanFlowState>({ kind: "idle" }),
    [],
  );

  const refs = useMemo(() => ({
    eventSource: null as EventSource | null,
    countdown: null as ReturnType<typeof setInterval> | null,
    sessionId: 0,
    arm: null as ActiveArm | null,
    cachedTargets: [] as TapTargetEntry[],
  }), []);

  const prefersReducedMotion = useMemo(readPrefersReducedMotion, []);

  // ---- side-effect cleanup ----
  const closeEventSource = (): void => {
    if (refs.eventSource) {
      try {
        refs.eventSource.close();
      } catch { /* already closed */ }
      refs.eventSource = null;
    }
  };
  const clearCountdown = (): void => {
    if (refs.countdown !== null) {
      clearInterval(refs.countdown);
      refs.countdown = null;
    }
  };

  const releaseArm = async (): Promise<void> => {
    const arm = refs.arm;
    if (!arm) return;
    refs.arm = null;
    const url = arm.pairableType === "device"
      ? `/api/admin/devices/${encodeURIComponent(arm.deviceId)}/scan-arm`
      : "/api/auth/scan-pair";
    const body = arm.pairableType === "device"
      ? { pairingCode: arm.pairingCode }
      : { chargeBoxId: arm.deviceId, pairingCode: arm.pairingCode };
    try {
      await fetch(url, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      });
    } catch { /* swallow — TTL handles the worst case */ }
  };

  const cleanup = (): void => {
    closeEventSource();
    clearCountdown();
    void releaseArm();
  };

  // ---- target loading ----
  const loadTargets = async (mySession: number): Promise<void> => {
    state.value = { kind: "loadingTargets" };
    let resp: Response;
    try {
      resp = await fetch("/api/auth/scan-tap-targets", {
        headers: { Accept: "application/json" },
      });
    } catch {
      if (mySession !== refs.sessionId) return;
      state.value = {
        kind: "error",
        message: "Couldn't reach the device list. Check your connection.",
        canRetry: true,
        backToPicker: true,
      };
      return;
    }
    if (mySession !== refs.sessionId) return;
    if (!resp.ok) {
      state.value = {
        kind: "error",
        message: resp.status === 503
          ? "Scan service is temporarily unavailable."
          : "Couldn't load the device list. Try again in a moment.",
        canRetry: resp.status !== 503,
        backToPicker: true,
      };
      return;
    }
    const body = await resp.json().catch(() => ({}));
    const list: TapTargetEntry[] = Array.isArray(body?.devices)
      ? body.devices
      : [];
    refs.cachedTargets = list;
    if (list.length === 0) {
      state.value = { kind: "noTargets" };
      return;
    }
    if (opts.preselectedId) {
      const match = list.find((d) =>
        d.deviceId === opts.preselectedId!.deviceId &&
        d.pairableType === opts.preselectedId!.pairableType
      );
      if (match && match.isOnline) {
        await beginArm(match, mySession);
        return;
      }
    }
    state.value = { kind: "picker", targets: list };
  };

  // ---- arm ----
  const beginArm = async (
    target: TapTargetEntry,
    mySession: number,
  ): Promise<void> => {
    state.value = { kind: "arming", target };

    const isDevice = target.pairableType === "device";
    const armUrl = isDevice
      ? `/api/admin/devices/${encodeURIComponent(target.deviceId)}/scan-arm`
      : opts.mode === "customer"
      ? "/api/auth/scan-pair"
      : "/api/admin/tag/scan-arm";

    const armBody = isDevice
      ? {
        purpose: opts.purpose === "login" ? "login" : "admin-link",
        hintLabel: opts.hintLabel ?? null,
      }
      : { chargeBoxId: target.deviceId };

    let armResp: Response;
    try {
      armResp = await fetch(armUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(armBody),
      });
    } catch {
      if (mySession !== refs.sessionId) return;
      state.value = {
        kind: "error",
        message: "Couldn't reach the scan service. Check your connection.",
        canRetry: true,
        backToPicker: true,
      };
      return;
    }
    if (mySession !== refs.sessionId) return;

    const armBodyResp: ArmResponse = await armResp.json().catch(() => ({}));
    if (!armResp.ok || !armBodyResp.pairingCode) {
      const friendly = armResp.status === 409
        ? "That device is already armed for another scan. Wait a moment and try again."
        : armResp.status === 429
        ? "Too many attempts. Wait a moment and try again."
        : armResp.status === 503
        ? "Scan service is temporarily unavailable."
        : "Couldn't arm the scan. Try again.";
      state.value = {
        kind: "error",
        message: friendly,
        canRetry: armResp.status !== 503,
        backToPicker: true,
      };
      return;
    }

    refs.arm = {
      pairableType: target.pairableType,
      pairingCode: armBodyResp.pairingCode,
      deviceId: target.deviceId,
      mode: opts.mode,
    };

    // Subscribe to the SSE stream that broadcasts scan.intercepted +
    // bidirectional cancel events. Same endpoint for both flows; query
    // param picks the binding.
    const queryParam = isDevice ? "deviceId" : "chargeBoxId";
    const url = `/api/auth/scan-detect?pairingCode=${
      encodeURIComponent(armBodyResp.pairingCode)
    }&${queryParam}=${encodeURIComponent(target.deviceId)}`;

    let es: EventSource;
    try {
      es = new EventSource(url);
    } catch {
      if (mySession !== refs.sessionId) return;
      state.value = {
        kind: "error",
        message: "Couldn't open the detection stream. Try again.",
        canRetry: true,
        backToPicker: true,
      };
      return;
    }
    if (mySession !== refs.sessionId) {
      try {
        es.close();
      } catch { /* noop */ }
      return;
    }
    refs.eventSource = es;

    // Default to the requested TTL; the `connected` event upgrades us
    // to the canonical server timestamp once the stream is alive.
    const fallbackExpiresAt = Date.now() + ttlSeconds * 1000;
    state.value = {
      kind: "armed",
      target,
      pairingCode: armBodyResp.pairingCode,
      expiresAtEpochMs: fallbackExpiresAt,
      remaining: ttlSeconds,
    };
    startCountdown(mySession);

    es.addEventListener("connected", (event: MessageEvent) => {
      if (mySession !== refs.sessionId) return;
      try {
        const data = JSON.parse(event.data ?? "{}") as {
          expiresAtEpochMs?: number;
          expiresInSec?: number;
        };
        const cur = state.value;
        if (cur.kind !== "armed") return;
        let expiresAtEpochMs = cur.expiresAtEpochMs;
        if (typeof data.expiresAtEpochMs === "number") {
          expiresAtEpochMs = data.expiresAtEpochMs;
        } else if (typeof data.expiresInSec === "number") {
          expiresAtEpochMs = Date.now() + data.expiresInSec * 1000;
        }
        const remaining = Math.max(
          1,
          Math.ceil((expiresAtEpochMs - Date.now()) / 1000),
        );
        state.value = { ...cur, expiresAtEpochMs, remaining };
      } catch { /* default countdown is fine */ }
    });

    es.addEventListener("cancelled", () => {
      if (mySession !== refs.sessionId) return;
      // The server already removed the verifications row — don't fire a
      // redundant DELETE.
      refs.arm = null;
      closeEventSource();
      clearCountdown();
      state.value = {
        kind: "error",
        message: "Scan was cancelled on the device. Try again?",
        canRetry: true,
        backToPicker: false,
      };
    });

    es.addEventListener("timeout", () => {
      if (mySession !== refs.sessionId) return;
      cleanup();
      state.value = {
        kind: "error",
        message: "No tag detected in time. Try again.",
        canRetry: true,
        backToPicker: false,
      };
    });

    es.onmessage = (event: MessageEvent) => {
      if (mySession !== refs.sessionId) return;
      let payload: ScanDetectEvent | null = null;
      try {
        payload = JSON.parse(event.data) as ScanDetectEvent;
      } catch { /* ignore */ }
      if (!payload || !payload.idTag) return;
      // Server already consumed the verification row; release locally.
      refs.arm = null;
      closeEventSource();
      clearCountdown();
      state.value = {
        kind: "detected",
        target,
        idTag: payload.idTag,
        nonce: payload.nonce,
        nonceTimestamp: payload.t,
        pairingCode: armBodyResp.pairingCode!,
      };
      void resolve(payload, target, armBodyResp.pairingCode!, mySession);
    };

    es.onerror = () => {
      if (mySession !== refs.sessionId) return;
      // EventSource fires `error` during normal reconnect attempts. Treat
      // as fatal only when the underlying connection is closed and we
      // haven't already reached a terminal state.
      if (refs.eventSource && refs.eventSource.readyState !== 2) return;
      const cur = state.value.kind;
      if (
        cur === "detected" || cur === "resolving" || cur === "success" ||
        cur === "error"
      ) {
        return;
      }
      cleanup();
      state.value = {
        kind: "error",
        message: "Lost connection to the detection stream. Try again.",
        canRetry: true,
        backToPicker: true,
      };
    };
  };

  const startCountdown = (mySession: number): void => {
    clearCountdown();
    refs.countdown = setInterval(() => {
      if (mySession !== refs.sessionId) return;
      const cur = state.value;
      if (cur.kind !== "armed") return;
      const remaining = Math.max(
        0,
        Math.ceil((cur.expiresAtEpochMs - Date.now()) / 1000),
      );
      if (remaining <= 0) {
        cleanup();
        state.value = {
          kind: "error",
          message: "No tag detected in 90 seconds. Try again.",
          canRetry: true,
          backToPicker: false,
        };
        return;
      }
      state.value = { ...cur, remaining };
    }, 1000);
  };

  // ---- resolution ----
  const resolve = async (
    detected: ScanDetectEvent,
    target: TapTargetEntry,
    pairingCode: string,
    mySession: number,
  ): Promise<void> => {
    const idTag = detected.idTag;
    state.value = { kind: "resolving", idTag };

    if (opts.resolve.kind === "customer-login") {
      // Customer login completion: POST scan-login with the SSE-supplied
      // HMAC nonce, then redirect.
      try {
        const resp = await fetch("/api/auth/scan-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pairingCode,
            chargeBoxId: target.pairableType === "charger"
              ? target.deviceId
              : undefined,
            deviceId: target.pairableType === "device"
              ? target.deviceId
              : undefined,
            idTag,
            nonce: detected.nonce,
            t: detected.t,
          }),
        });
        if (mySession !== refs.sessionId) return;
        const body = await resp.json().catch(() => ({})) as {
          redirectTo?: string;
        };
        if (!resp.ok) {
          const msg = resp.status === 401
            ? "That card isn't linked to a customer account. Contact your operator."
            : resp.status === 410
            ? "This pairing was already used. Try again."
            : resp.status === 403
            ? "Couldn't verify your scan. Try again."
            : "Couldn't sign you in. Try again or use email instead.";
          state.value = {
            kind: "error",
            message: msg,
            canRetry: true,
            backToPicker: false,
          };
          return;
        }
        state.value = {
          kind: "success",
          message: "Signed in. Redirecting…",
        };
        const dest = body.redirectTo ?? "/";
        try {
          globalThis.location.replace(dest);
        } catch { /* fallback below */ }
      } catch {
        if (mySession !== refs.sessionId) return;
        state.value = {
          kind: "error",
          message: "Couldn't finish signing you in. Try again.",
          canRetry: true,
          backToPicker: false,
        };
      }
      return;
    }

    // Admin paths: POST scan-lookup to enrich, then run the resolve strategy.
    let result: ScanResult | null = null;
    try {
      const res = await fetch("/api/admin/tag/scan-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idTag }),
      });
      if (mySession !== refs.sessionId) return;
      if (!res.ok) {
        // Lookup failed but we still have the idTag — for "add-tag", route
        // through to /tags/new. For other purposes, surface an error.
        if (opts.purpose === "add-tag" || opts.purpose === "lookup-tag") {
          result = { idTag, exists: false };
        } else {
          state.value = {
            kind: "error",
            message: `Couldn't look up ${idTag}. Try again.`,
            canRetry: true,
            backToPicker: false,
          };
          return;
        }
      } else {
        const payload = await res.json().catch(() => ({}));
        result = {
          idTag,
          exists: Boolean(payload.exists),
          tagPk: typeof payload.tagPk === "number" ? payload.tagPk : undefined,
          hasMapping: typeof payload.hasMapping === "boolean"
            ? payload.hasMapping
            : undefined,
          mappingId: typeof payload.mappingId === "number"
            ? payload.mappingId
            : payload.mappingId === null
            ? null
            : undefined,
        };
      }
    } catch {
      if (mySession !== refs.sessionId) return;
      state.value = {
        kind: "error",
        message: `Couldn't look up ${idTag}. Try again.`,
        canRetry: true,
        backToPicker: false,
      };
      return;
    }

    if (mySession !== refs.sessionId || !result) return;

    if (opts.resolve.kind === "callback") {
      try {
        await opts.resolve.fn(result);
        state.value = { kind: "success", message: "Done." };
      } catch (err) {
        state.value = {
          kind: "error",
          message: err instanceof Error ? err.message : "Something went wrong.",
          canRetry: true,
          backToPicker: false,
        };
      }
      return;
    }
    // route
    const dest = opts.resolve.build(result);
    state.value = { kind: "success", message: `Opening ${dest}…` };
    try {
      globalThis.location.assign(dest);
    } catch { /* noop */ }
  };

  // ---- public API ----
  const start = (): void => {
    cleanup();
    const mySession = ++refs.sessionId;
    if (opts.preselected) {
      void beginArm(opts.preselected, mySession);
      return;
    }
    void loadTargets(mySession);
  };

  const selectTarget = (t: TapTargetEntry): void => {
    cleanup();
    const mySession = ++refs.sessionId;
    void beginArm(t, mySession);
  };

  const backToPicker = (): void => {
    cleanup();
    const mySession = ++refs.sessionId;
    if (refs.cachedTargets.length > 0) {
      state.value = { kind: "picker", targets: refs.cachedTargets };
    } else {
      void loadTargets(mySession);
    }
  };

  const retry = (): void => {
    const cur = state.value;
    if (cur.kind !== "error") return;
    if (cur.backToPicker) {
      backToPicker();
      return;
    }
    // Re-arm same target — find it in cache via the last arm.
    cleanup();
    const mySession = ++refs.sessionId;
    if (opts.preselected) {
      void beginArm(opts.preselected, mySession);
      return;
    }
    // The error message lost the target; fall back to picker.
    if (refs.cachedTargets.length > 0) {
      state.value = { kind: "picker", targets: refs.cachedTargets };
    } else {
      void loadTargets(mySession);
    }
  };

  const submitManual = (idTag: string): void => {
    const trimmed = idTag.trim();
    if (!trimmed) return;
    if (opts.mode === "customer") return; // disallowed
    cleanup();
    const mySession = ++refs.sessionId;
    state.value = { kind: "resolving", idTag: trimmed };
    void resolve(
      { idTag: trimmed },
      // Synthesize a target placeholder — display name is "manual".
      {
        deviceId: "manual",
        pairableType: "device",
        kind: "phone_nfc",
        label: "Manual entry",
        friendlyName: "Manual entry",
        capabilities: ["tap"],
        isOnline: true,
      },
      "manual",
      mySession,
    );
  };

  const shutdown = async (): Promise<void> => {
    closeEventSource();
    clearCountdown();
    refs.sessionId++;
    await releaseArm();
    state.value = { kind: "idle" };
  };

  // Mount-scoped cleanup so a navigation doesn't leave an SSE / arm row
  // open in the background.
  useEffect(() => {
    return () => {
      closeEventSource();
      clearCountdown();
      refs.sessionId++;
      void releaseArm();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    state,
    prefersReducedMotion,
    start,
    selectTarget,
    backToPicker,
    retry,
    submitManual,
    shutdown,
  };
}

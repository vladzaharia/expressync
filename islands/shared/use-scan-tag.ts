/**
 * useScanTag — state machine + side-effect orchestration for the Scan Tag
 * modal (`islands/TapToAddModal.tsx`) and its entry points.
 *
 * Why a custom hook? The modal needs to coordinate several independent
 * concerns (SSE stream lifecycle, a countdown tick, a lookup POST, a routing
 * decision, and a handful of recoverable error states). Splitting this into
 * a single typed state machine keeps the view dumb and makes cleanup bullet-
 * proof — `close()` or unmount aborts every outstanding side effect, so
 * there's no lingering `EventSource`, interval, or auto-confirm timeout.
 *
 * The hook supports two pipelines via `armEndpoint`:
 *   - **legacy log-scrape** (`armEndpoint` omitted): opens an EventSource to
 *     `/api/admin/tag/detect`. Works for unknown tags only — known tags get
 *     `ACCEPTED` from SteVe and never surface a `reject` log line. Retained
 *     only for backwards-compat callers; new admin call sites pass
 *     `armEndpoint`.
 *   - **arm-intent** (`armEndpoint` set, e.g. `/api/admin/tag/scan-arm`):
 *     POSTs the arm endpoint to register a pairing intent at a specific
 *     `chargeBoxId`, then opens `/api/auth/scan-detect?pairingCode=…&
 *     chargeBoxId=…`. Works for known AND unknown tags via the SteVe
 *     pre-Authorize hook. The arm endpoint is DELETEd on close/unmount.
 *
 * The hook exposes signals so islands can reactively render without extra
 * prop plumbing. Every transition dispatches a `scan-tag:state` CustomEvent
 * for diagnostics; `scan-tag:detected`, `scan-tag:route`, and
 * `scan-tag:error` fire on their respective terminal transitions.
 */

import { type Signal, signal } from "@preact/signals";
import { useEffect, useMemo } from "preact/hooks";

export type ScanTagState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "waiting"; remaining: number; extended: boolean }
  | { kind: "detected"; idTag: string; remaining: number }
  | { kind: "resolving"; idTag: string }
  | { kind: "routing"; idTag: string; destination: string }
  | { kind: "timeout" }
  | { kind: "unavailable"; reason: "docker" | "detect_503" }
  | { kind: "network_error"; phase: "connect" | "stream" }
  | { kind: "lookup_failed"; idTag: string; status: number }
  | { kind: "dismissed" };

export interface ScanResult {
  idTag: string;
  exists: boolean;
  tagPk?: number;
  hasMapping?: boolean;
  mappingId?: number | null;
}

export interface UseScanTagOptions {
  /** Countdown length for `waiting` and for `extend()`. Default 20. */
  timeoutSeconds?: number;
  /**
   * `manual` (default) leaves `detected` in place until the caller calls
   * `confirm()`. `auto` schedules a best-effort 800ms auto-confirm so the
   * operator can cancel out if they landed on the wrong tag.
   */
  confirmMode?: "auto" | "manual";
  /** Fired after a successful `scan-lookup` POST and before routing. */
  onDetected?: (r: ScanResult) => void | Promise<void>;
  /**
   * Arm-intent endpoint. When set, the hook POSTs `{chargeBoxId}` to this
   * URL, then subscribes to `/api/auth/scan-detect` with the returned
   * pairingCode. DELETE is fired on close/unmount. Admin callers pass
   * `/api/admin/tag/scan-arm`. Customer login uses
   * `/api/auth/scan-pair` (handled by `CustomerScanLoginIsland` directly,
   * not this hook).
   *
   * When omitted, the hook falls back to the legacy log-scrape stream at
   * `/api/admin/tag/detect` (unknown tags only).
   */
  armEndpoint?: string;
  /**
   * Charger to arm the intent at. Only used when `armEndpoint` is set.
   * If omitted, the hook auto-discovers the first online charger via
   * `/api/auth/scan-tap-targets`.
   */
  chargeBoxId?: string;
}

export interface UseScanTagApi {
  state: Signal<ScanTagState>;
  prefersReducedMotion: boolean;
  open: () => void;
  close: () => void;
  confirm: () => void;
  /** From `detected`, drop back to `waiting` (re-arm the stream if needed). */
  cancel: () => void;
  /** In `waiting`, reset the countdown to `timeoutSeconds` once. */
  extend: () => void;
  /** Recover from any error/timeout state by reconnecting. */
  retry: () => void;
  /** Bypass the SSE flow and resolve `idTag` directly. */
  submitManual: (idTag: string) => void;
}

type Transition = {
  from: ScanTagState["kind"];
  to: ScanTagState["kind"];
  idTag?: string;
};

/**
 * One row of the unified tap-target picker as returned by
 * `GET /api/auth/scan-tap-targets`. The legacy `/api/auth/scan-charger-list`
 * shape (`chargeBoxId` + `friendlyName` + `online`) was retired in Wave 2;
 * we now consume `TapTargetEntry`-shaped rows but down-project to the legacy
 * fields below for the existing scan-charger flow. D3 (Wave 4) replaces this
 * hook with a device-aware picker that handles both `pairableType` values.
 */
interface TapTargetListEntry {
  deviceId: string;
  pairableType: "device" | "charger";
  kind: "charger" | "phone_nfc" | "laptop_nfc";
  label: string;
  capabilities: string[];
  isOnline: boolean;
  isOwnDevice?: boolean;
}

interface ArmResponse {
  pairingCode?: string;
  chargeBoxId?: string;
  expiresInSec?: number;
}

function dispatch(name: string, detail: Record<string, unknown>): void {
  if (typeof globalThis.dispatchEvent !== "function") return;
  try {
    globalThis.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    // swallow — diagnostics only
  }
}

function transitionEvent(t: Transition): void {
  dispatch("scan-tag:state", { ...t, at: Date.now() });
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

export function useScanTag(opts?: UseScanTagOptions): UseScanTagApi {
  const timeoutSeconds = Math.max(1, opts?.timeoutSeconds ?? 20);
  const confirmMode = opts?.confirmMode ?? "manual";
  const armEndpoint = opts?.armEndpoint;
  const fixedChargeBoxId = opts?.chargeBoxId;

  // One signal per island instance — created lazily inside `useMemo` so
  // multiple mounts don't share state.
  const state = useMemo<Signal<ScanTagState>>(
    () => signal<ScanTagState>({ kind: "idle" }),
    [],
  );

  // Side-effect handles. Kept in `useMemo` refs so `close()` / `retry()`
  // can reach them without re-creating the hook API each render.
  const refs = useMemo(() => ({
    eventSource: null as EventSource | null,
    tickInterval: null as ReturnType<typeof setInterval> | null,
    autoConfirmTimer: null as ReturnType<typeof setTimeout> | null,
    // Simple dismissed-guard so late async resolves can't clobber state
    // after the user closed the modal.
    sessionId: 0,
    // Active arm-intent binding (only set when `armEndpoint` is in use).
    arm: null as { pairingCode: string; chargeBoxId: string } | null,
  }), []);

  const prefersReducedMotion = useMemo(readPrefersReducedMotion, []);

  const setState = (next: ScanTagState): void => {
    const prev = state.value;
    state.value = next;
    const idTag = (next as { idTag?: string }).idTag ??
      (prev as { idTag?: string }).idTag;
    transitionEvent({ from: prev.kind, to: next.kind, idTag });
  };

  const clearTick = (): void => {
    if (refs.tickInterval !== null) {
      clearInterval(refs.tickInterval);
      refs.tickInterval = null;
    }
  };

  const clearAutoConfirm = (): void => {
    if (refs.autoConfirmTimer !== null) {
      clearTimeout(refs.autoConfirmTimer);
      refs.autoConfirmTimer = null;
    }
  };

  const closeEventSource = (): void => {
    if (refs.eventSource) {
      try {
        refs.eventSource.close();
      } catch {
        // ignore — closing an already-closed ES throws on some runtimes
      }
      refs.eventSource = null;
    }
  };

  // Best-effort release of an armed pairing. Fired when we tear down the
  // SSE so the charger doesn't stay "listening" for a tap for the
  // remainder of the 90s TTL (and so the next attempt isn't blocked by
  // the "already_armed_for_charger" guard).
  const releaseArmIfActive = (): void => {
    if (!armEndpoint || !refs.arm) return;
    const { pairingCode, chargeBoxId } = refs.arm;
    refs.arm = null;
    try {
      void fetch(armEndpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chargeBoxId, pairingCode }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* noop */
    }
  };

  // Unconditional cleanup — called on close(), retry(), and unmount. Never
  // gated on `open` because that race caused the old modal to leak SSE
  // connections when the dialog was toggled rapidly.
  const cleanup = (): void => {
    closeEventSource();
    clearTick();
    clearAutoConfirm();
    releaseArmIfActive();
  };

  const startTick = (): void => {
    clearTick();
    refs.tickInterval = setInterval(() => {
      const cur = state.value;
      if (cur.kind === "waiting") {
        const remaining = cur.remaining - 1;
        if (remaining <= 0) {
          cleanup();
          setState({ kind: "timeout" });
          dispatch("scan-tag:error", { reason: "timeout" });
          return;
        }
        state.value = { ...cur, remaining };
      } else if (cur.kind === "detected") {
        const remaining = Math.max(0, cur.remaining - 1);
        state.value = { ...cur, remaining };
      }
    }, 1000);
  };

  /**
   * Pick a charger to arm against. Honors `opts.chargeBoxId` when set;
   * otherwise queries the public charger list and picks the first online
   * entry. Returns `null` and signals an unavailability state if no
   * charger is reachable.
   */
  const resolveChargeBoxId = async (
    mySession: number,
  ): Promise<string | null> => {
    if (fixedChargeBoxId) return fixedChargeBoxId;
    let resp: Response;
    try {
      resp = await fetch("/api/auth/scan-tap-targets", {
        headers: { Accept: "application/json" },
      });
    } catch {
      if (mySession !== refs.sessionId) return null;
      setState({ kind: "network_error", phase: "connect" });
      dispatch("scan-tag:error", { reason: "connect" });
      return null;
    }
    if (mySession !== refs.sessionId) return null;
    if (resp.status === 503) {
      setState({ kind: "unavailable", reason: "detect_503" });
      dispatch("scan-tag:error", { reason: "detect_503" });
      return null;
    }
    if (!resp.ok) {
      setState({ kind: "network_error", phase: "connect" });
      dispatch("scan-tag:error", { reason: "connect" });
      return null;
    }
    const body = await resp.json().catch(() => ({}));
    // Wave 2: response shape changed from `{ chargers: [...] }` to
    // `{ devices: TapTargetEntry[] }`. The legacy hook only knows how to
    // arm at a charger pairableId, so we filter to charger rows here. D3
    // in Wave 4 replaces this hook with a device-aware picker that can
    // arm phone-side scans too.
    const list: TapTargetListEntry[] = Array.isArray(body?.devices)
      ? body.devices
      : [];
    const onlineCharger = list.find(
      (e) => e.pairableType === "charger" && e.isOnline,
    );
    if (!onlineCharger) {
      setState({ kind: "unavailable", reason: "detect_503" });
      dispatch("scan-tag:error", { reason: "no_chargers" });
      return null;
    }
    // For chargers the view emits `id = chargeBoxId`, surfaced here as
    // `deviceId` per the unified contract.
    return onlineCharger.deviceId;
  };

  /**
   * Arm-intent pipeline: POST armEndpoint → open scan-detect SSE bound by
   * pairingCode + chargeBoxId. Runs only when `armEndpoint` is set.
   */
  const beginConnectArmIntent = async (mySession: number): Promise<void> => {
    if (!armEndpoint) return;
    const chargeBoxId = await resolveChargeBoxId(mySession);
    if (!chargeBoxId) return;
    if (mySession !== refs.sessionId) return;

    let armResp: Response;
    try {
      armResp = await fetch(armEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chargeBoxId }),
      });
    } catch {
      if (mySession !== refs.sessionId) return;
      setState({ kind: "network_error", phase: "connect" });
      dispatch("scan-tag:error", { reason: "connect" });
      return;
    }
    if (mySession !== refs.sessionId) return;
    if (armResp.status === 503) {
      setState({ kind: "unavailable", reason: "detect_503" });
      dispatch("scan-tag:error", { reason: "detect_503" });
      return;
    }
    const armBody: ArmResponse = await armResp.json().catch(() => ({}));
    if (!armResp.ok || !armBody.pairingCode || !armBody.chargeBoxId) {
      setState({ kind: "network_error", phase: "connect" });
      dispatch("scan-tag:error", {
        reason: "arm_failed",
        status: armResp.status,
      });
      return;
    }

    refs.arm = {
      pairingCode: armBody.pairingCode,
      chargeBoxId: armBody.chargeBoxId,
    };

    let es: EventSource;
    try {
      const url = `/api/auth/scan-detect?pairingCode=${
        encodeURIComponent(armBody.pairingCode)
      }&chargeBoxId=${encodeURIComponent(armBody.chargeBoxId)}`;
      es = new EventSource(url);
    } catch {
      setState({ kind: "network_error", phase: "connect" });
      dispatch("scan-tag:error", { reason: "connect" });
      return;
    }
    if (mySession !== refs.sessionId) {
      try {
        es.close();
      } catch { /* noop */ }
      return;
    }
    refs.eventSource = es;

    es.addEventListener("connected", () => {
      if (mySession !== refs.sessionId) return;
      setState({
        kind: "waiting",
        remaining: timeoutSeconds,
        extended: false,
      });
      startTick();
    });

    // scan-detect emits anonymous `data:` events (no event-type line) for
    // detected tags — listen via onmessage rather than `tag-detected`.
    es.onmessage = (event: MessageEvent) => {
      if (mySession !== refs.sessionId) return;
      let idTag = "";
      try {
        const data = JSON.parse(event.data);
        idTag = typeof data.idTag === "string" ? data.idTag : "";
      } catch {
        idTag = "";
      }
      if (!idTag) return;
      const cur = state.value;
      const remaining = cur.kind === "waiting" ? cur.remaining : timeoutSeconds;
      // Tear down the SSE + arm row — the intent has been consumed
      // server-side on match; the DELETE is best-effort cleanup.
      closeEventSource();
      releaseArmIfActive();
      setState({ kind: "detected", idTag, remaining });
      dispatch("scan-tag:detected", { idTag });

      if (confirmMode === "auto") {
        clearAutoConfirm();
        refs.autoConfirmTimer = setTimeout(() => {
          if (mySession !== refs.sessionId) return;
          if (state.value.kind === "detected") confirm();
        }, 800);
      }
    };

    es.addEventListener("timeout", () => {
      if (mySession !== refs.sessionId) return;
      cleanup();
      setState({ kind: "timeout" });
      dispatch("scan-tag:error", { reason: "timeout" });
    });

    es.onerror = () => {
      if (mySession !== refs.sessionId) return;
      // EventSource fires `error` on normal reconnect attempts too. Treat
      // as fatal only when the underlying connection is closed.
      if (refs.eventSource && refs.eventSource.readyState !== 2) return;
      const phase: "connect" | "stream" = state.value.kind === "connecting"
        ? "connect"
        : "stream";
      cleanup();
      setState({ kind: "network_error", phase });
      dispatch("scan-tag:error", { reason: "network", phase });
    };
  };

  /**
   * Legacy log-scrape pipeline: HEAD-probe `/api/admin/tag/detect`, then
   * open the SSE. Detects unknown-tag scans only (known tags don't surface
   * via Authorize-reject log lines).
   */
  const beginConnectLegacy = (mySession: number): void => {
    (async () => {
      try {
        const probe = await fetch(`/api/admin/tag/detect?timeout=1`, {
          method: "HEAD",
        });
        if (mySession !== refs.sessionId) return;
        if (probe.status === 503) {
          setState({ kind: "unavailable", reason: "detect_503" });
          dispatch("scan-tag:error", { reason: "detect_503" });
          return;
        }
      } catch {
        if (mySession !== refs.sessionId) return;
      }

      let es: EventSource;
      try {
        es = new EventSource(`/api/admin/tag/detect?timeout=${timeoutSeconds}`);
      } catch {
        setState({ kind: "network_error", phase: "connect" });
        dispatch("scan-tag:error", { reason: "connect" });
        return;
      }
      if (mySession !== refs.sessionId) {
        try {
          es.close();
        } catch { /* noop */ }
        return;
      }
      refs.eventSource = es;

      es.addEventListener("connected", () => {
        if (mySession !== refs.sessionId) return;
        setState({
          kind: "waiting",
          remaining: timeoutSeconds,
          extended: false,
        });
        startTick();
      });

      es.addEventListener("tag-detected", (event: MessageEvent) => {
        if (mySession !== refs.sessionId) return;
        let idTag = "";
        try {
          const data = JSON.parse(event.data);
          idTag = typeof data.tagId === "string" ? data.tagId : "";
        } catch {
          idTag = "";
        }
        if (!idTag) return;
        const cur = state.value;
        const remaining = cur.kind === "waiting"
          ? cur.remaining
          : timeoutSeconds;
        closeEventSource();
        setState({ kind: "detected", idTag, remaining });
        dispatch("scan-tag:detected", { idTag });

        if (confirmMode === "auto") {
          clearAutoConfirm();
          refs.autoConfirmTimer = setTimeout(() => {
            if (mySession !== refs.sessionId) return;
            if (state.value.kind === "detected") confirm();
          }, 800);
        }
      });

      es.addEventListener("timeout", () => {
        if (mySession !== refs.sessionId) return;
        cleanup();
        setState({ kind: "timeout" });
        dispatch("scan-tag:error", { reason: "timeout" });
      });

      es.onerror = () => {
        if (mySession !== refs.sessionId) return;
        const phase: "connect" | "stream" = state.value.kind === "connecting"
          ? "connect"
          : "stream";
        cleanup();
        setState({ kind: "network_error", phase });
        dispatch("scan-tag:error", { reason: "network", phase });
      };
    })();
  };

  const beginConnect = (): void => {
    cleanup();
    const mySession = ++refs.sessionId;
    setState({ kind: "connecting" });

    if (armEndpoint) {
      void beginConnectArmIntent(mySession);
    } else {
      beginConnectLegacy(mySession);
    }
  };

  const confirm = (): void => {
    const cur = state.value;
    if (cur.kind !== "detected") return;
    const idTag = cur.idTag;
    clearAutoConfirm();
    clearTick();
    setState({ kind: "resolving", idTag });
    const mySession = refs.sessionId;

    (async () => {
      try {
        const res = await fetch("/api/admin/tag/scan-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idTag }),
        });
        if (mySession !== refs.sessionId) return;
        if (!res.ok) {
          setState({ kind: "lookup_failed", idTag, status: res.status });
          dispatch("scan-tag:error", {
            reason: "lookup_failed",
            status: res.status,
          });
          return;
        }
        const payload = await res.json().catch(() => ({}));
        const result: ScanResult = {
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

        // Pick a destination preview now so the `routing` state has something
        // to render even if the caller overrides routing via `onDetected`.
        const destination = result.exists && typeof result.tagPk === "number"
          ? `/tags/${result.tagPk}`
          : `/tags/new?idTag=${encodeURIComponent(idTag)}`;
        setState({ kind: "routing", idTag, destination });
        dispatch("scan-tag:route", { idTag, destination, result });
        if (opts?.onDetected) {
          await opts.onDetected(result);
        }
      } catch {
        if (mySession !== refs.sessionId) return;
        setState({ kind: "lookup_failed", idTag, status: 0 });
        dispatch("scan-tag:error", { reason: "lookup_failed", status: 0 });
      }
    })();
  };

  const submitManual = (idTag: string): void => {
    const trimmed = idTag.trim();
    if (!trimmed) return;
    cleanup();
    setState({ kind: "resolving", idTag: trimmed });
    const mySession = ++refs.sessionId;

    (async () => {
      try {
        const res = await fetch("/api/admin/tag/scan-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idTag: trimmed }),
        });
        if (mySession !== refs.sessionId) return;
        if (!res.ok) {
          setState({
            kind: "lookup_failed",
            idTag: trimmed,
            status: res.status,
          });
          dispatch("scan-tag:error", {
            reason: "lookup_failed",
            status: res.status,
          });
          return;
        }
        const payload = await res.json().catch(() => ({}));
        const result: ScanResult = {
          idTag: trimmed,
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
        const destination = result.exists && typeof result.tagPk === "number"
          ? `/tags/${result.tagPk}`
          : `/tags/new?idTag=${encodeURIComponent(trimmed)}`;
        setState({ kind: "routing", idTag: trimmed, destination });
        dispatch("scan-tag:route", { idTag: trimmed, destination, result });
        if (opts?.onDetected) {
          await opts.onDetected(result);
        }
      } catch {
        if (mySession !== refs.sessionId) return;
        setState({ kind: "lookup_failed", idTag: trimmed, status: 0 });
        dispatch("scan-tag:error", { reason: "lookup_failed", status: 0 });
      }
    })();
  };

  const open = (): void => {
    // Reset to idle, then kick off a fresh connect. This resets the
    // session id so any in-flight async resolves are discarded.
    cleanup();
    state.value = { kind: "idle" };
    beginConnect();
  };

  const close = (): void => {
    cleanup();
    refs.sessionId++;
    setState({ kind: "dismissed" });
  };

  const cancel = (): void => {
    const cur = state.value;
    if (cur.kind !== "detected") return;
    clearAutoConfirm();
    // Drop back to waiting; re-arm the stream since the `tag-detected`
    // handler closed it.
    setState({ kind: "connecting" });
    beginConnect();
  };

  const extend = (): void => {
    const cur = state.value;
    if (cur.kind !== "waiting") return;
    setState({
      kind: "waiting",
      remaining: timeoutSeconds,
      extended: true,
    });
  };

  const retry = (): void => {
    beginConnect();
  };

  // Mount-scoped cleanup so a rogue navigation doesn't leave an SSE stream
  // open in the background. Independent from `close()` callers.
  useEffect(() => {
    return () => {
      cleanup();
      refs.sessionId++;
    };
  }, []);

  return {
    state,
    prefersReducedMotion,
    open,
    close,
    confirm,
    cancel,
    extend,
    retry,
    submitManual,
  };
}

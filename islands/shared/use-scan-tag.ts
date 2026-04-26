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
 *     tap-target, then opens `/api/auth/scan-detect?pairingCode=…&…`.
 *     Works for known AND unknown tags via the SteVe pre-Authorize hook
 *     (chargers) or the device scan-result endpoint (phones / laptops).
 *     The arm endpoint is DELETEd on close/unmount.
 *
 * Wave 4 D3 generalised the hook to handle phone tap-targets in addition
 * to chargers: the user-facing options now talk in terms of `deviceId`
 * (the canonical `TapTargetEntry.deviceId`, which is `chargeBoxId` for
 * chargers and a UUID for phones/laptops), and the arm dispatch branches
 * on `pairableType`:
 *   - `'charger'` → POST `armEndpoint` (default `/api/admin/tag/scan-arm`)
 *     with `{chargeBoxId}`. SSE filter: `?chargeBoxId=…`.
 *   - `'device'`  → POST `/api/admin/devices/{deviceId}/scan-arm` with
 *     `{purpose: 'admin-link'}`. SSE filter: `?deviceId=…`.
 *
 * The hook exposes signals so islands can reactively render without extra
 * prop plumbing. Every transition dispatches a `scan-tag:state` CustomEvent
 * for diagnostics; `scan-tag:detected`, `scan-tag:route`, and
 * `scan-tag:error` fire on their respective terminal transitions.
 */

import { type Signal, signal } from "@preact/signals";
import { useEffect, useMemo } from "preact/hooks";
import type { TapTargetEntry } from "@/src/lib/types/devices.ts";

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
   * Arm-intent endpoint for the **charger** branch. When set, the hook
   * POSTs `{chargeBoxId}` to this URL, then subscribes to
   * `/api/auth/scan-detect` with the returned pairingCode. DELETE is fired
   * on close/unmount. Admin callers pass `/api/admin/tag/scan-arm`.
   * Customer login uses `/api/auth/scan-pair` (handled directly by
   * `CustomerScanLoginIsland`, not this hook).
   *
   * The device-side branch (`pairableType === 'device'`) ignores this opt
   * and dispatches to `/api/admin/devices/{deviceId}/scan-arm` per Wave 3
   * C-scan-arm.
   *
   * When omitted, the hook falls back to the legacy log-scrape stream at
   * `/api/admin/tag/detect` (unknown tags only, charger-only flow).
   */
  armEndpoint?: string;
  /**
   * Pre-selected tap-target to arm against. For phones this is the device
   * UUID; for chargers it's the `chargeBoxId` (the unified contract uses
   * `deviceId` as the canonical name on `TapTargetEntry`). When omitted,
   * the hook auto-discovers via `/api/auth/scan-tap-targets` — picking an
   * online own-phone if exactly one is available, otherwise returning the
   * first online charger so the legacy flow keeps working unchanged.
   */
  deviceId?: string;
  /**
   * Pairable type of the pre-selected target. Required when `deviceId` is
   * a phone UUID (`'device'`) so the dispatch hits the right arm
   * endpoint. Defaults to `'charger'` to preserve the pre-D3 behaviour
   * for callers that haven't migrated yet.
   */
  pairableType?: TapTargetEntry["pairableType"];
  /**
   * Backward-compat alias for `deviceId`. Old call sites pass this; new
   * code should use `deviceId`. When both are set, `deviceId` wins.
   *
   * @deprecated Use `deviceId` (with optional `pairableType: 'charger'`).
   */
  chargeBoxId?: string;
  /**
   * Hint label woven into the device-side scan-arm POST body. Surfaced in
   * the iOS push notification ("Tap a card now — Front desk"). Ignored on
   * the charger branch.
   */
  hintLabel?: string;
  /**
   * Fired once a tap-target resolves (either supplied or auto-discovered)
   * so the host UI can stamp `state.steps` / `state.readerName` before the
   * waiting state renders. Optional — when omitted, the picker selection
   * UI is owned entirely by the caller via the picker component.
   */
  onTargetResolved?: (target: TapTargetEntry) => void;
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

interface ArmResponse {
  pairingCode?: string;
  /** Charger arm only; absent on device arm responses. */
  chargeBoxId?: string;
  /** Device arm only; absent on charger arm responses. */
  deviceId?: string;
  expiresInSec?: number;
}

/** Active arm-intent binding. We carry pairableType so cleanup hits the
 *  right release endpoint and the SSE URL gets the right query param. */
interface ActiveArm {
  pairableType: TapTargetEntry["pairableType"];
  pairingCode: string;
  /** UUID for devices; chargeBoxId for chargers — unified name. */
  deviceId: string;
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

/** URL of the device-side scan-arm endpoint (Wave 3 C-scan-arm). */
function deviceScanArmUrl(deviceId: string): string {
  return `/api/admin/devices/${encodeURIComponent(deviceId)}/scan-arm`;
}

export function useScanTag(opts?: UseScanTagOptions): UseScanTagApi {
  const timeoutSeconds = Math.max(1, opts?.timeoutSeconds ?? 20);
  const confirmMode = opts?.confirmMode ?? "manual";
  const armEndpoint = opts?.armEndpoint;
  // Honour the canonical name first; fall back to the legacy alias so
  // pre-D3 callers (e.g. ScanTagPaletteHost still passing `chargeBoxId`
  // until its rename lands) keep working without churn.
  const fixedDeviceId = opts?.deviceId ?? opts?.chargeBoxId;
  const fixedPairableType: TapTargetEntry["pairableType"] =
    opts?.pairableType ??
      "charger";
  const hintLabel = opts?.hintLabel;
  const onTargetResolved = opts?.onTargetResolved;

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
    arm: null as ActiveArm | null,
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
  // SSE so the target doesn't stay "listening" for a tap for the
  // remainder of the 90s TTL (and so the next attempt isn't blocked by
  // the "already_armed" guard). Branches on the active binding's
  // `pairableType` so the right release endpoint is hit.
  const releaseArmIfActive = (): void => {
    if (!refs.arm) return;
    const arm = refs.arm;
    refs.arm = null;
    try {
      if (arm.pairableType === "device") {
        // Device branch: /api/admin/devices/{id}/scan-arm DELETE expects
        // `{pairingCode}` in the body (deviceId is on the URL).
        void fetch(deviceScanArmUrl(arm.deviceId), {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pairingCode: arm.pairingCode }),
          keepalive: true,
        }).catch(() => {});
        return;
      }
      // Charger branch: legacy admin scan-arm DELETE expects
      // `{chargeBoxId, pairingCode}`. The configured `armEndpoint` is
      // required here — without it we can't release.
      if (!armEndpoint) return;
      void fetch(armEndpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chargeBoxId: arm.deviceId,
          pairingCode: arm.pairingCode,
        }),
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
   * Pick a tap-target to arm against. Honours an explicitly-supplied
   * `deviceId` (with `pairableType`); otherwise queries
   * `/api/auth/scan-tap-targets` and:
   *   1. Auto-picks the operator's own phone when exactly one online
   *      `isOwnDevice` row exists (the D3 default — fastest path for a
   *      phone-equipped admin).
   *   2. Falls back to the first online charger so the legacy admin
   *      flow keeps working when no phones are registered.
   *
   * Returns the resolved target or `null` (and emits an unavailable
   * state) when no online target is reachable.
   */
  const resolveTapTargetDeviceId = async (
    mySession: number,
  ): Promise<TapTargetEntry | null> => {
    if (fixedDeviceId) {
      // Synthesize a TapTargetEntry from the caller-supplied opts. We
      // don't have label/capabilities here; downstream UI is expected to
      // have already set state.steps / readerName via its own picker.
      return {
        deviceId: fixedDeviceId,
        pairableType: fixedPairableType,
        kind: fixedPairableType === "charger" ? "charger" : "phone_nfc",
        label: fixedDeviceId,
        capabilities: ["tap"],
        isOnline: true,
      };
    }
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
    const list: TapTargetEntry[] = Array.isArray(body?.devices)
      ? body.devices
      : [];

    // D3 auto-pick rule: exactly one online own-phone wins. Otherwise
    // fall back to the first online charger so the legacy auto-discover
    // path remains intact for admins without a registered phone.
    const onlineOwnPhones = list.filter(
      (e) => e.isOwnDevice === true && e.isOnline,
    );
    if (onlineOwnPhones.length === 1) {
      return onlineOwnPhones[0];
    }
    const onlineCharger = list.find(
      (e) => e.pairableType === "charger" && e.isOnline,
    );
    if (onlineCharger) return onlineCharger;

    setState({ kind: "unavailable", reason: "detect_503" });
    dispatch("scan-tag:error", { reason: "no_chargers" });
    return null;
  };

  /**
   * Arm-intent pipeline: POST armEndpoint → open scan-detect SSE bound by
   * pairingCode + tap-target. Runs only when `armEndpoint` is set (charger
   * branch) or the resolved target's `pairableType === 'device'`.
   */
  const beginConnectArmIntent = async (mySession: number): Promise<void> => {
    const target = await resolveTapTargetDeviceId(mySession);
    if (!target) return;
    if (mySession !== refs.sessionId) return;

    // Notify the host UI so it can stamp readerName / steps before
    // setState transitions into `waiting` (which renders the panel).
    if (onTargetResolved) {
      try {
        onTargetResolved(target);
      } catch {
        // swallow — diagnostics only
      }
    }

    // Pick the arm URL + body shape based on the resolved pairableType.
    const isDeviceBranch = target.pairableType === "device";
    if (isDeviceBranch && armEndpoint && armEndpoint !== "") {
      // We've been given a charger arm endpoint, but the target is a
      // phone — that's a misconfiguration. Surface as a network error so
      // the operator can retry; the picker should have prevented this.
    }
    const armUrl = isDeviceBranch
      ? deviceScanArmUrl(target.deviceId)
      : armEndpoint;
    if (!armUrl) {
      setState({ kind: "network_error", phase: "connect" });
      dispatch("scan-tag:error", { reason: "arm_failed", status: 0 });
      return;
    }
    const armBody = isDeviceBranch
      ? { purpose: "admin-link", hintLabel }
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
    const armRespBody: ArmResponse = await armResp.json().catch(() => ({}));
    if (!armResp.ok || !armRespBody.pairingCode) {
      setState({ kind: "network_error", phase: "connect" });
      dispatch("scan-tag:error", {
        reason: "arm_failed",
        status: armResp.status,
      });
      return;
    }

    // For chargers we trust the server's echoed `chargeBoxId`. For
    // devices, the URL was keyed by deviceId — re-use the resolved
    // target's deviceId.
    const boundDeviceId = isDeviceBranch
      ? target.deviceId
      : (armRespBody.chargeBoxId ?? target.deviceId);

    refs.arm = {
      pairableType: target.pairableType,
      pairingCode: armRespBody.pairingCode,
      deviceId: boundDeviceId,
    };

    let es: EventSource;
    try {
      const queryParam = isDeviceBranch ? "deviceId" : "chargeBoxId";
      const url = `/api/auth/scan-detect?pairingCode=${
        encodeURIComponent(armRespBody.pairingCode)
      }&${queryParam}=${encodeURIComponent(boundDeviceId)}`;
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

    // The arm-intent pipeline runs whenever the caller has either set
    // `armEndpoint` (charger branch) OR pinned a device-side target.
    const wantsArmIntent = !!armEndpoint ||
      (!!fixedDeviceId && fixedPairableType === "device");
    if (wantsArmIntent) {
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

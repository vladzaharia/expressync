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

  // Unconditional cleanup — called on close(), retry(), and unmount. Never
  // gated on `open` because that race caused the old modal to leak SSE
  // connections when the dialog was toggled rapidly.
  const cleanup = (): void => {
    closeEventSource();
    clearTick();
    clearAutoConfirm();
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

  const beginConnect = (): void => {
    cleanup();
    const mySession = ++refs.sessionId;
    setState({ kind: "connecting" });

    // HEAD probe first so we can distinguish "Docker unavailable (503)"
    // from "generic SSE error" — otherwise the operator just sees a vague
    // "connection lost" for an operational misconfiguration.
    (async () => {
      try {
        const probe = await fetch(`/api/tag/detect?timeout=1`, {
          method: "HEAD",
        });
        if (mySession !== refs.sessionId) return;
        if (probe.status === 503) {
          setState({ kind: "unavailable", reason: "detect_503" });
          dispatch("scan-tag:error", { reason: "detect_503" });
          return;
        }
      } catch {
        // HEAD failing is not fatal on its own; defer to SSE onerror.
        if (mySession !== refs.sessionId) return;
      }

      let es: EventSource;
      try {
        es = new EventSource(`/api/tag/detect?timeout=${timeoutSeconds}`);
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
            // Only auto-confirm if still in `detected` (user may have hit
            // `cancel` in the interim).
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
        const res = await fetch("/api/tag/scan-lookup", {
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
        const res = await fetch("/api/tag/scan-lookup", {
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

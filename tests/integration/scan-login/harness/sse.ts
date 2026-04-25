/**
 * sse.ts — minimal SSE client. We only need to read scan-detect events.
 */

export interface SseMessage {
  event?: string;
  data: string;
  id?: string;
}

export interface SseStream {
  next(timeoutMs?: number): Promise<SseMessage>;
  close(): void;
}

export async function openSse(
  url: string,
  opts: { headers?: Record<string, string>; connectedTimeoutMs?: number } = {},
): Promise<SseStream> {
  const ctrl = new AbortController();
  const resp = await fetch(url, {
    headers: { Accept: "text/event-stream", ...(opts.headers ?? {}) },
    signal: ctrl.signal,
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`SSE connect failed: ${resp.status} ${resp.statusText}`);
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  const queue: SseMessage[] = [];
  const waiters: Array<{
    resolve: (m: SseMessage) => void;
    reject: (e: Error) => void;
  }> = [];
  // deno-lint-ignore no-explicit-any
  let connectedResolve: (m: SseMessage) => void = () => {};
  // deno-lint-ignore no-explicit-any
  let connectedReject: (e: Error) => void = () => {};
  const connectedPromise = new Promise<SseMessage>((res, rej) => {
    connectedResolve = res;
    connectedReject = rej;
  });
  let sawConnected = false;

  function emit(rawBlock: string) {
    const msg: SseMessage = { data: "" };
    const dataLines: string[] = [];
    for (const line of rawBlock.split("\n")) {
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const field = line.slice(0, colon);
      const value = line.slice(colon + 1).replace(/^ /, "");
      if (field === "data") dataLines.push(value);
      else if (field === "event") msg.event = value;
      else if (field === "id") msg.id = value;
    }
    msg.data = dataLines.join("\n");

    // Trap the `connected` server-side handshake — resolve the openSse
    // gate but do NOT enqueue it for `next()` consumers (they only want
    // payload `data:` frames).
    if (msg.event === "connected") {
      if (!sawConnected) {
        sawConnected = true;
        connectedResolve(msg);
      }
      return;
    }
    // Skip any other non-data frames (e.g. `event: timeout`,
    // `event: error`) and keepalives are already filtered above (lines
    // starting with `:`).
    if (!msg.data) return;

    if (waiters.length > 0) {
      waiters.shift()!.resolve(msg);
    } else {
      queue.push(msg);
    }
  }

  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        let idx = buffer.indexOf("\n\n");
        while (idx >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (block.trim()) emit(block);
          idx = buffer.indexOf("\n\n");
        }
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      while (waiters.length > 0) waiters.shift()!.reject(e);
      if (!sawConnected) connectedReject(e);
    }
  })();

  // Block until the server emits `event: connected` so callers can be
  // sure the event-bus subscription is live before they trigger the
  // event source. Without this gate, scan.intercepted events that fire
  // in the ~10–50ms window between fetch() returning and the
  // ReadableStream `start(controller)` callback running can be lost.
  const gateTimeoutMs = opts.connectedTimeoutMs ?? 5_000;
  const gateTimer = setTimeout(() => {
    connectedReject(
      new Error(
        `SSE connected event not received within ${gateTimeoutMs}ms`,
      ),
    );
  }, gateTimeoutMs);
  try {
    await connectedPromise;
  } finally {
    clearTimeout(gateTimer);
  }

  return {
    next(timeoutMs = 10_000): Promise<SseMessage> {
      if (queue.length > 0) return Promise.resolve(queue.shift()!);
      return new Promise<SseMessage>((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.resolve === resolve);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error(`SSE next() timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        waiters.push({
          resolve: (m) => { clearTimeout(timer); resolve(m); },
          reject: (e) => { clearTimeout(timer); reject(e); },
        });
      });
    },
    close() {
      try { ctrl.abort(); } catch { /* */ }
    },
  };
}

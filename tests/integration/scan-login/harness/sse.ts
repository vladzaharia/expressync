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
  opts: { headers?: Record<string, string> } = {},
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
    }
  })();

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

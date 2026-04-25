/**
 * assert.ts — small DSL on top of std/assert for poll-and-retry assertions.
 */

export async function assertEventually<T>(
  fn: () => Promise<T> | T,
  opts: { timeoutMs?: number; intervalMs?: number; message?: string } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const intervalMs = opts.intervalMs ?? 100;
  const start = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await fn();
      if (v !== undefined && v !== null && v !== false) return v;
      lastErr = new Error("predicate returned falsy");
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `assertEventually timed out after ${timeoutMs}ms: ${opts.message ?? ""}\nlast error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

export async function assertWithinMs<T>(
  budgetMs: number,
  fn: () => Promise<T>,
  label = "operation",
): Promise<T> {
  const start = performance.now();
  const v = await fn();
  const elapsed = performance.now() - start;
  if (elapsed > budgetMs) {
    throw new Error(`${label} exceeded budget: ${elapsed.toFixed(1)}ms > ${budgetMs}ms`);
  }
  return v;
}

export async function hmacHexSign(key: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(body));
  const bytes = new Uint8Array(sig);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

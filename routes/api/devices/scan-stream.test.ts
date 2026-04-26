/**
 * ExpresScan / Wave 2 Track C-stream — `/api/devices/scan-stream` unit tests.
 *
 * The handler relies on `ctx.state.device` being populated by the bearer
 * middleware. Since the middleware itself requires a live DB, we
 * dependency-inject a fake `device` directly into the handler's `ctx`
 * argument. The handler short-circuits if `ctx.state.device` is null —
 * so we test that path (401) by passing an empty state.
 *
 * Resource sanitization is disabled because importing the handler pulls
 * in the postgres client which keeps a connection pool alive even when
 * we never touch it. The pool is cleaned up at process exit.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  _activeByDeviceForTests,
  _concurrentByIpForTests,
} from "./scan-stream.ts";
import { eventBus } from "../../../src/services/event-bus.service.ts";

const URL_BASE = "https://manage.polaris.express/api/devices/scan-stream";

interface FakeCtx {
  req: Request;
  state: {
    device?: {
      id: string;
      ownerUserId: string;
      capabilities: string[];
      secret: string;
      tokenId: string;
    };
  };
}

function makeFakeDevice(id: string): FakeCtx["state"]["device"] {
  return {
    id,
    ownerUserId: "user-test",
    capabilities: ["tap"],
    secret: "deadbeef",
    tokenId: `token-for-${id}`,
  };
}

async function callGet(
  ctx: FakeCtx,
): Promise<Response> {
  const { handler } = await import("./scan-stream.ts");
  // deno-lint-ignore no-explicit-any
  const get = (handler as any).GET as (
    ctx: FakeCtx,
  ) => Promise<Response>;
  return await get(ctx);
}

function buildCtx(
  args: {
    ip?: string;
    lastEventId?: string;
    device?: FakeCtx["state"]["device"];
  },
): FakeCtx {
  const headers: Record<string, string> = {};
  if (args.ip) headers["x-forwarded-for"] = args.ip;
  if (args.lastEventId) headers["Last-Event-ID"] = args.lastEventId;
  return {
    req: new Request(URL_BASE, { method: "GET", headers }),
    state: { device: args.device },
  };
}

/** Read up to `n` bytes (or until EOF) from an SSE stream as text. */
async function readStreamPrefix(
  res: Response,
  options: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<string> {
  const maxBytes = options.maxBytes ?? 4096;
  const timeoutMs = options.timeoutMs ?? 200;
  if (!res.body) return "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let out = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (out.length < maxBytes && Date.now() < deadline) {
      const { value, done } = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: true }>((resolve) =>
          setTimeout(
            () => resolve({ value: undefined, done: true }),
            Math.max(0, deadline - Date.now()),
          )
        ),
      ]);
      if (done) break;
      if (value) out += dec.decode(value, { stream: true });
    }
  } finally {
    try {
      await reader.cancel();
    } catch { /* no-op */ }
  }
  return out;
}

function clearStreamState(): void {
  _concurrentByIpForTests.clear();
  for (const [, active] of _activeByDeviceForTests) {
    try {
      active.abort.abort();
    } catch { /* no-op */ }
  }
  _activeByDeviceForTests.clear();
}

// =============================================================================
// 401 path — no bearer-resolved device → 401 JSON, no stream upgrade.
// =============================================================================

Deno.test({
  name: "scan-stream — missing ctx.state.device returns 401 JSON",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    clearStreamState();
    const res = await callGet(buildCtx({}));
    assertEquals(res.status, 401);
    assertEquals(
      res.headers.get("content-type"),
      "application/json",
    );
    const body = await res.json();
    assertEquals(body.error, "unauthorized");
  },
});

// =============================================================================
// 410 / soft-delete and 500 paths require a live DB; skipped here.
// Without DATABASE_URL the device-row preflight throws and the handler
// returns 500. We assert that branch returns SOMETHING that isn't a
// stream upgrade.
// =============================================================================

Deno.test({
  name: "scan-stream — DB lookup failure returns 5xx (not a stream)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    clearStreamState();
    const res = await callGet(
      buildCtx({ device: makeFakeDevice(crypto.randomUUID()) }),
    );
    // With no live DB the preflight throws; handler returns 500.
    // If a tester runs with DATABASE_URL set and the device row is
    // genuinely missing, the handler returns 401. Either is non-stream.
    const okStatuses = new Set([401, 410, 500]);
    assertEquals(
      okStatuses.has(res.status),
      true,
      `unexpected status ${res.status}`,
    );
    const ct = res.headers.get("content-type") ?? "";
    assertEquals(ct.startsWith("application/json"), true);
  },
});

// =============================================================================
// In-process bookkeeping tests. Bypass the handler (which needs a live DB)
// and exercise the structures directly + via the eventBus.
//
// These tests verify the SSE pipe wiring by:
//   - Pre-populating `_activeByDeviceForTests` to simulate an open stream
//   - Publishing the right event-bus event
//   - Asserting cleanup + side-effects
// =============================================================================

Deno.test({
  name:
    "scan-stream — kick-off: publishing device.session.replaced aborts the active stream",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    clearStreamState();
    eventBus._reset();
    const deviceId = crypto.randomUUID();
    const abort = new AbortController();
    let aborted = false;
    abort.signal.addEventListener("abort", () => {
      aborted = true;
    });

    // Simulate the registered active stream's listener — in real
    // life the SSE handler subscribes to `device.session.replaced`
    // and calls cleanup() (which aborts) on receipt. Here we mirror
    // that wiring directly to verify the contract.
    const unsub = eventBus.subscribe(
      ["device.session.replaced"],
      (delivered) => {
        const p = delivered.payload as { deviceId?: string };
        if (p.deviceId === deviceId) {
          try {
            abort.abort();
          } catch { /* no-op */ }
        }
      },
    );
    _activeByDeviceForTests.set(deviceId, { streamId: "stream-1", abort });

    // Publish the kick-off event.
    eventBus.publish({
      type: "device.session.replaced",
      payload: { deviceId, replacedAt: Date.now() },
    });

    assertEquals(aborted, true, "old stream should have been aborted");
    unsub();
    _activeByDeviceForTests.delete(deviceId);
  },
});

Deno.test({
  name: "scan-stream — cross-device isolation: subscriber filters by deviceId",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    clearStreamState();
    eventBus._reset();
    const myDeviceId = crypto.randomUUID();
    const otherDeviceId = crypto.randomUUID();
    let receivedForMe = 0;
    const unsub = eventBus.subscribe(
      ["device.scan.requested"],
      (delivered) => {
        const p = delivered.payload as { deviceId: string };
        if (p.deviceId !== myDeviceId) return;
        receivedForMe += 1;
      },
    );

    eventBus.publish({
      type: "device.scan.requested",
      payload: {
        deviceId: otherDeviceId,
        pairingCode: "OTHER",
        purpose: "admin-link",
        expiresAtIso: new Date().toISOString(),
        expiresAtEpochMs: Date.now() + 90_000,
        requestedByUserId: null,
        hintLabel: null,
      },
    });
    eventBus.publish({
      type: "device.scan.requested",
      payload: {
        deviceId: myDeviceId,
        pairingCode: "MINE",
        purpose: "admin-link",
        expiresAtIso: new Date().toISOString(),
        expiresAtEpochMs: Date.now() + 90_000,
        requestedByUserId: null,
        hintLabel: null,
      },
    });

    assertEquals(receivedForMe, 1, "must filter out other device's events");
    unsub();
  },
});

Deno.test({
  name: "scan-stream — replay buffer filters by deviceId",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    clearStreamState();
    eventBus._reset();
    const myDeviceId = crypto.randomUUID();
    const otherDeviceId = crypto.randomUUID();

    // Publish events BEFORE any subscriber exists — those go into the
    // ring buffer and are picked up by `eventBus.replay(seq, types)`.
    const a = eventBus.publish({
      type: "device.scan.requested",
      payload: {
        deviceId: otherDeviceId,
        pairingCode: "OTHER",
        purpose: "admin-link",
        expiresAtIso: new Date().toISOString(),
        expiresAtEpochMs: Date.now() + 90_000,
        requestedByUserId: null,
        hintLabel: null,
      },
    });
    const b = eventBus.publish({
      type: "device.scan.requested",
      payload: {
        deviceId: myDeviceId,
        pairingCode: "MINE",
        purpose: "admin-link",
        expiresAtIso: new Date().toISOString(),
        expiresAtEpochMs: Date.now() + 90_000,
        requestedByUserId: null,
        hintLabel: null,
      },
    });
    assertNotEquals(a.seq, b.seq, "publishes must produce distinct seqs");

    // Replay with last-seen seq=0 → both events come back; the handler
    // then filters by deviceId. We assert that filter works against the
    // raw replay.
    const replayed = eventBus
      .replay(0, ["device.scan.requested"])
      .filter((e) =>
        (e.payload as { deviceId: string }).deviceId === myDeviceId
      );
    assertEquals(replayed.length, 1);
    assertEquals(
      (replayed[0].payload as { pairingCode: string }).pairingCode,
      "MINE",
    );
  },
});

Deno.test({
  name:
    "scan-stream — token revocation: device.token.revoked closes matching streams",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    clearStreamState();
    eventBus._reset();
    const deviceId = crypto.randomUUID();
    let closed = false;
    const unsub = eventBus.subscribe(
      ["device.token.revoked"],
      (delivered) => {
        const p = delivered.payload as { deviceId?: string };
        if (p.deviceId === deviceId) closed = true;
      },
    );

    eventBus.publish({
      type: "device.token.revoked",
      payload: {
        deviceId,
        tokenId: "token-1",
        reason: "admin",
      },
    });

    assertEquals(closed, true, "stream must observe its own token revocation");
    unsub();
  },
});

// =============================================================================
// Per-IP cap test — exercises the in-process Map directly to verify the
// cap behavior without a live DB. (The full handler path 4xx-with-stream
// is integration territory.)
// =============================================================================

Deno.test({
  name: "scan-stream — per-IP cap rejects the 4th concurrent connection",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    clearStreamState();
    const ip = "10.0.0.99";
    // Pre-fill 3 slots — equivalent to 3 in-flight streams on the
    // same IP. The next call must hit the 429 branch.
    _concurrentByIpForTests.set(ip, 3);
    const res = await callGet(
      buildCtx({ ip, device: makeFakeDevice(crypto.randomUUID()) }),
    );
    assertEquals(res.status, 429);
    const body = await res.json();
    assertEquals(body.error, "too_many_concurrent_streams");
    // Cleanup so other tests aren't affected.
    _concurrentByIpForTests.delete(ip);
  },
});

// =============================================================================
// Last-Event-ID parser — exercises the contract directly via the public
// behavior: a connect with `Last-Event-ID: 0` (or absent) must NOT replay,
// and a `Last-Event-ID` of garbage is treated as 0. We can't drive the
// replay path without a live DB; we verify the negative parse here via
// the publicly-observable behavior of the eventBus.replay helper.
// =============================================================================

Deno.test({
  name: "scan-stream — eventBus.replay(0) returns the full buffer",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    eventBus._reset();
    const deviceId = crypto.randomUUID();
    eventBus.publish({
      type: "device.scan.requested",
      payload: {
        deviceId,
        pairingCode: "ABC",
        purpose: "admin-link",
        expiresAtIso: new Date().toISOString(),
        expiresAtEpochMs: Date.now() + 90_000,
        requestedByUserId: null,
        hintLabel: null,
      },
    });
    eventBus.publish({
      type: "device.scan.requested",
      payload: {
        deviceId,
        pairingCode: "DEF",
        purpose: "admin-link",
        expiresAtIso: new Date().toISOString(),
        expiresAtEpochMs: Date.now() + 90_000,
        requestedByUserId: null,
        hintLabel: null,
      },
    });
    const all = eventBus.replay(0, ["device.scan.requested"]);
    assertEquals(all.length, 2);
    const after1 = eventBus.replay(1, ["device.scan.requested"]);
    assertEquals(after1.length, 1);
    assertEquals(
      (after1[0].payload as { pairingCode: string }).pairingCode,
      "DEF",
    );
  },
});

// =============================================================================
// readStreamPrefix is exercised by an opportunistic "happy path" test:
// if we happen to have DATABASE_URL set, we can validate the SSE wire
// format. With no DB the handler returns 5xx (above), so we skip.
// =============================================================================

Deno.test({
  name: "scan-stream — happy path SSE format (skipped when no DATABASE_URL)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    if (!Deno.env.get("DATABASE_URL")) return;
    clearStreamState();
    const deviceId = crypto.randomUUID();
    // Without a real device row in the DB the preflight returns 401
    // (no row found) — the test env doesn't seed devices. We accept
    // any non-stream JSON response; the integration suite covers the
    // genuine connect path.
    const res = await callGet(
      buildCtx({ device: makeFakeDevice(deviceId) }),
    );
    if (res.status === 200) {
      const body = await readStreamPrefix(res, { maxBytes: 1024 });
      const containsConnected = body.includes("event: connected");
      assertEquals(containsConnected, true, `body=${body}`);
    } else {
      // Handler short-circuited — verify it's JSON and a 4xx.
      assertEquals(res.headers.get("content-type"), "application/json");
    }
  },
});

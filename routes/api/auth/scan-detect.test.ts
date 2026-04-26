/**
 * ExpresScan / Wave 2 Track C-stream — `/api/auth/scan-detect` unit tests.
 *
 * Covers the generalized handler that accepts EITHER `chargeBoxId` (legacy
 * customer scan-to-login flow) OR `deviceId` (new ExpresScan device-scan
 * flow). The integration suite (`tests/integration/scan-login`) is the
 * regression gate for the charger flow against a real Postgres + StEvE.
 *
 * Resource sanitization is disabled because importing the handler pulls
 * in the postgres client which keeps a connection pool alive even when
 * the body validator short-circuits.
 */

import { assertEquals } from "@std/assert";
import { _concurrentByIpForTests } from "./scan-detect.ts";

const BASE_URL = "https://polaris.express/api/auth/scan-detect";

async function callGet(query: string): Promise<Response> {
  const { handler } = await import("./scan-detect.ts");
  // deno-lint-ignore no-explicit-any
  const get = (handler as any).GET as (
    ctx: { req: Request },
  ) => Promise<Response>;
  const url = `${BASE_URL}${query}`;
  return await get({ req: new Request(url, { method: "GET" }) });
}

// =============================================================================
// Query-param branching — neither / both / each-alone.
// =============================================================================

Deno.test({
  name: "scan-detect — missing both pairingCode and chargeBoxId/deviceId → 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _concurrentByIpForTests.clear();
    const res = await callGet("");
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(
      typeof body.error === "string" && body.error.includes("required"),
      true,
      `unexpected body ${JSON.stringify(body)}`,
    );
  },
});

Deno.test({
  name: "scan-detect — missing pairingCode (chargeBoxId only) → 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _concurrentByIpForTests.clear();
    const res = await callGet("?chargeBoxId=CB-A");
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name: "scan-detect — missing pairingCode (deviceId only) → 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _concurrentByIpForTests.clear();
    const res = await callGet("?deviceId=00000000-0000-0000-0000-000000000000");
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name: "scan-detect — pairingCode only (no chargeBoxId or deviceId) → 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _concurrentByIpForTests.clear();
    const res = await callGet("?pairingCode=abc");
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name: "scan-detect — both chargeBoxId and deviceId set → 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _concurrentByIpForTests.clear();
    const res = await callGet(
      "?pairingCode=abc&chargeBoxId=CB-A&deviceId=00000000-0000-0000-0000-000000000000",
    );
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(
      body.error.includes("mutually_exclusive"),
      true,
      `unexpected body ${JSON.stringify(body)}`,
    );
  },
});

// =============================================================================
// Charger flow regression — without a live DB the pairing lookup throws,
// the handler returns 500. With DATABASE_URL set but no row, the lookup
// succeeds-empty and the handler returns 404 ("pairing_not_found"). Either
// way the handler routes correctly through the charger branch (the alt is
// 400, which would mean the param parse rejected it — that's the real
// regression to guard against).
// =============================================================================

Deno.test({
  name: "scan-detect — charger flow (chargeBoxId set) does NOT 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _concurrentByIpForTests.clear();
    const res = await callGet("?pairingCode=abc&chargeBoxId=CB-A");
    // Without a matching armed verification row the handler returns
    // either 404 (DB available, no row), 500 (DB unavailable), or
    // 200 (a stream — only if a real DB happens to have the row). All
    // are acceptable; the regression guard is "NOT 400".
    assertEquals(
      res.status === 200 || res.status === 404 || res.status === 500,
      true,
      `unexpected status ${res.status}`,
    );
    if (res.status === 200) {
      // Drain so the stream test doesn't leak. We only need to know
      // that the upgrade headers are SSE-shaped.
      assertEquals(
        res.headers.get("content-type"),
        "text/event-stream",
      );
      try {
        await res.body?.cancel();
      } catch { /* no-op */ }
    }
  },
});

Deno.test({
  name: "scan-detect — device flow (deviceId set) does NOT 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _concurrentByIpForTests.clear();
    const res = await callGet(
      "?pairingCode=abc&deviceId=00000000-0000-0000-0000-000000000000",
    );
    assertEquals(
      res.status === 200 || res.status === 404 || res.status === 500,
      true,
      `unexpected status ${res.status}`,
    );
    if (res.status === 200) {
      assertEquals(
        res.headers.get("content-type"),
        "text/event-stream",
      );
      try {
        await res.body?.cancel();
      } catch { /* no-op */ }
    }
  },
});

// =============================================================================
// Per-IP cap — pre-fill the in-process counter and assert 429.
// =============================================================================

Deno.test({
  name: "scan-detect — per-IP cap rejects the 4th concurrent connection",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _concurrentByIpForTests.clear();
    // The handler reads `x-forwarded-for` first; we emulate by
    // setting the header on the Request manually.
    const { handler } = await import("./scan-detect.ts");
    // deno-lint-ignore no-explicit-any
    const get = (handler as any).GET as (
      ctx: { req: Request },
    ) => Promise<Response>;

    const ip = "10.1.2.99";
    _concurrentByIpForTests.set(ip, 3);

    const url = `${BASE_URL}?pairingCode=abc&chargeBoxId=CB-A`;
    const req = new Request(url, {
      method: "GET",
      headers: { "x-forwarded-for": ip },
    });
    const res = await get({ req });
    assertEquals(res.status, 429);
    const body = await res.json();
    assertEquals(body.error, "too_many_concurrent_streams");

    _concurrentByIpForTests.delete(ip);
  },
});

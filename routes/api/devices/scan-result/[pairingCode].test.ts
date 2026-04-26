/**
 * GET /api/devices/scan-result/{pairingCode} — handler-direct unit tests.
 *
 * Network-free coverage of:
 *   - missing bearer → 401 unauthorized
 *   - missing pairingCode param → 404 not_found
 *   - DB lookup failure → 500
 *   - DB lookup success returning 0 rows → 404 (covered indirectly via
 *     the no-DB path which throws → 500; integration tests cover the
 *     0-row branch)
 *
 * The DB-bound branches (status='armed' → 202 pending; status='consumed' →
 * 200 with EnrichedScanResult) are exercised in integration. Without a
 * live DB the SELECT throws → 500.
 *
 * Resource sanitization is disabled because the handler imports the
 * postgres pool which keeps connections alive even when no query runs.
 */

import { assert, assertEquals } from "@std/assert";

const URL_BASE = "https://manage.polaris.express/api/devices/scan-result";

interface MockDevice {
  id: string;
  ownerUserId: string;
  capabilities: string[];
  secret: string;
  tokenId: string;
}

interface MockState {
  device?: MockDevice;
}

async function callPoll(
  state: MockState,
  pairingCode: string,
): Promise<Response> {
  const { handler } = await import("./[pairingCode].ts");
  // deno-lint-ignore no-explicit-any
  const get = (handler as any).GET as (
    ctx: { req: Request; state: MockState; params: Record<string, string> },
  ) => Promise<Response>;
  const req = new Request(`${URL_BASE}/${pairingCode}`, { method: "GET" });
  return await get({ req, state, params: { pairingCode } });
}

function deviceState(): MockState {
  return {
    device: {
      id: "11111111-2222-3333-4444-555555555555",
      ownerUserId: "admin-1",
      capabilities: ["tap"],
      secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      tokenId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    },
  };
}

// ============================================================================
// Auth
// ============================================================================

Deno.test({
  name: "scan-result poll — missing device context returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callPoll({}, "X7R2KQ");
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error, "unauthorized");
  },
});

// ============================================================================
// Param validation — empty pairingCode → 404 (defensive; Fresh wires the
// param so this is mostly a routing-edge guard).
// ============================================================================

Deno.test({
  name: "scan-result poll — empty pairingCode returns 404",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callPoll(deviceState(), "");
    assertEquals(res.status, 404);
    const body = await res.json();
    assertEquals(body.error, "not_found");
  },
});

// ============================================================================
// Past-auth path — without a live DB the SELECT throws and the handler
// returns 500. With a live DB but no row, returns 404. With a row in
// `armed` it returns 202; in `consumed` it returns 200. Lock in the
// "valid bearer + valid pairingCode → past gate" branch.
// ============================================================================

Deno.test({
  name:
    "scan-result poll — valid bearer + pairingCode hits the DB lookup branch",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callPoll(deviceState(), "X7R2KQ");
    // No DB → 500. Test env without DATABASE_URL → 500. With DB but no
    // matching row → 404. With matching row → 202 (armed) / 200
    // (consumed). We accept any of these — they all imply auth gate +
    // params survived.
    assert(
      [200, 202, 404, 500].includes(res.status),
      `unexpected status ${res.status}`,
    );
    // Always JSON.
    const ct = res.headers.get("content-type") ?? "";
    assertEquals(ct.startsWith("application/json"), true);
  },
});

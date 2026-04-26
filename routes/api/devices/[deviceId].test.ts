/**
 * DELETE /api/devices/{deviceId} — handler-direct unit tests.
 *
 * Locks in the auth-gating branch table:
 *   - missing bearer → 401
 *   - malformed deviceId path param → 404
 *   - foreign deviceId (bearer resolves to a different device) → 403
 *   - matching deviceId proceeds past auth (DB-bound)
 *
 * The actual UPDATE + audit + event-bus publish are exercised in
 * integration tests; here we focus on the security-critical 403 branch.
 */

import { assert, assertEquals } from "@std/assert";

const URL_DELETE_BASE =
  "https://manage.polaris.express/api/devices/11111111-2222-3333-4444-555555555555";

interface MockState {
  device?: {
    id: string;
    ownerUserId: string;
    capabilities: string[];
    secret: string;
    tokenId: string;
  };
}

async function callDelete(
  state: MockState,
  pathDeviceId: string,
): Promise<Response> {
  const { handler } = await import("./[deviceId].ts");
  // deno-lint-ignore no-explicit-any
  const del = (handler as any).DELETE as (
    ctx: { req: Request; state: MockState; params: { deviceId: string } },
  ) => Promise<Response>;
  const req = new Request(URL_DELETE_BASE, { method: "DELETE" });
  return await del({ req, state, params: { deviceId: pathDeviceId } });
}

const VALID_UUID = "11111111-2222-3333-4444-555555555555";
const OTHER_UUID = "99999999-aaaa-bbbb-cccc-dddddddddddd";

function deviceState(id: string): MockState {
  return {
    device: {
      id,
      ownerUserId: "admin-1",
      capabilities: ["tap"],
      secret: "deadbeef".repeat(8),
      tokenId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    },
  };
}

// ============================================================================
// Auth gating
// ============================================================================

Deno.test({
  name: "DELETE /api/devices/{id} — missing device context returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callDelete({}, VALID_UUID);
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error, "unauthorized");
  },
});

Deno.test({
  name: "DELETE /api/devices/{id} — non-UUID deviceId returns 404",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callDelete(deviceState(VALID_UUID), "not-a-uuid");
    assertEquals(res.status, 404);
  },
});

// ============================================================================
// CRITICAL: foreign-deviceId rejection — a bearer cannot delete another
// device, even if both share an admin owner.
// ============================================================================

Deno.test({
  name:
    "DELETE /api/devices/{id} — foreign deviceId (bearer != path) returns 403",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // Bearer resolves to OTHER_UUID; path asks to delete VALID_UUID.
    const res = await callDelete(deviceState(OTHER_UUID), VALID_UUID);
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.error, "forbidden");
  },
});

Deno.test({
  name:
    "DELETE /api/devices/{id} — matching deviceId proceeds past auth gate (DB-bound)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callDelete(deviceState(VALID_UUID), VALID_UUID);
    // Without a DB the UPDATE throws → 500. Either way NOT 401/403/404.
    assert(
      res.status !== 401 && res.status !== 403 && res.status !== 404,
      `unexpected gate-blocking status ${res.status}`,
    );
  },
});

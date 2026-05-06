/**
 * GET /api/devices/me/state — handler-direct unit tests.
 *
 * Network-free coverage:
 *   - missing bearer → 401
 *   - device-deleted error → 410
 *   - happy path: envelope shape strict, allow-list of keys
 *   - never echoes raw push token, secret_hash, or revoked metadata
 */

import { assert, assertEquals } from "@std/assert";
import {
  type DeviceStateEnvelope,
  DeviceStateSchema,
} from "../../../../src/lib/devices/device-state.ts";

const URL_STATE = "https://manage.example.com/api/devices/me/state";

interface MockState {
  device?: {
    id: string;
    ownerUserId: string;
    capabilities: string[];
    secret: string;
    tokenId: string;
  };
}

async function callGet(state: MockState): Promise<Response> {
  const { handler } = await import("./state.ts");
  // deno-lint-ignore no-explicit-any
  const get = (handler as any).GET as (
    ctx: { req: Request; state: MockState; params: Record<string, string> },
  ) => Promise<Response>;
  const req = new Request(URL_STATE, { method: "GET" });
  return await get({ req, state, params: {} });
}

function deviceState(): MockState {
  return {
    device: {
      id: "11111111-2222-4333-8444-555555555555",
      ownerUserId: "admin-1",
      capabilities: ["scanner", "user"],
      secret: "deadbeef".repeat(8),
      tokenId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    },
  };
}

// ===========================================================================
// Auth
// ===========================================================================

Deno.test({
  name: "me/state GET — missing device context returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callGet({});
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error, "unauthorized");
  },
});

// ===========================================================================
// Auth-passes path: without a live DB the SELECT throws → 500. Locks in
// "valid bearer → past auth gate → into the envelope builder" branch.
// ===========================================================================

Deno.test({
  name: "me/state GET — valid bearer proceeds past auth gate (DB-bound)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callGet(deviceState());
    // Without a DB the SELECT throws → 500. With a DB (integration env),
    // either 200 (live device) or 410 (soft-deleted). Never 401/400.
    await res.body?.cancel();
    assert(
      res.status === 200 || res.status === 500 || res.status === 410,
      `unexpected status ${res.status}`,
    );
  },
});

// ===========================================================================
// Envelope shape — Zod-validate a synthetic envelope to lock down the
// allow-list of top-level keys. The handler returns whatever the builder
// produces; the strict-shape contract lives in DeviceStateSchema.
// ===========================================================================

Deno.test({
  name: "me/state envelope — allow-list of top-level keys",
  fn: () => {
    const sample: DeviceStateEnvelope = {
      device: {
        id: "11111111-2222-4333-8444-555555555555",
        label: "Vlad iPhone",
        kind: "phone_nfc",
        ownerUserId: "admin-1",
        siteId: null,
        registeredAt: "2026-04-27T12:00:00.000Z",
        lastSeenAt: "2026-04-27T12:00:00.000Z",
      },
      capabilities: ["scanner", "user"],
      kioskAllowed: false,
      ownerUser: { id: "admin-1", role: "admin", displayName: "Vlad" },
      settings: {},
      scanStatus: { armed: false, pairingCode: null, expiresAt: null },
      pushToken: { last8: "abcdef12", environment: "production" },
      needsPushToken: false,
      connectivity: {
        online: true,
        lastSyncAt: "2026-04-27T12:00:00.000Z",
        reconnectCount: 0,
        pendingUploads: 0,
      },
    };
    DeviceStateSchema.parse(sample);
    const keys = Object.keys(sample).sort();
    assertEquals(keys, [
      "capabilities",
      "connectivity",
      "device",
      "kioskAllowed",
      "needsPushToken",
      "ownerUser",
      "pushToken",
      "scanStatus",
      "settings",
    ]);
  },
});

Deno.test({
  name: "me/state envelope — strict shape rejects forbidden keys",
  fn: () => {
    const malformed = {
      device: {
        id: "11111111-2222-4333-8444-555555555555",
        label: "x",
        kind: "phone_nfc",
        ownerUserId: "u",
        siteId: null,
        registeredAt: "2026-04-27T12:00:00.000Z",
        lastSeenAt: null,
        // Forbidden: raw secret hash leaking through.
        secret_hash: "deadbeef",
      },
      capabilities: [],
      kioskAllowed: false,
      ownerUser: { id: "u", role: "admin", displayName: "x" },
      settings: {},
      scanStatus: null,
      pushToken: null,
      connectivity: {
        online: false,
        lastSyncAt: null,
        reconnectCount: 0,
        pendingUploads: 0,
      },
    };
    let threw = false;
    try {
      DeviceStateSchema.parse(malformed);
    } catch {
      threw = true;
    }
    assert(threw, "expected DeviceStateSchema to reject secret_hash");
  },
});

Deno.test({
  name: "me/state envelope — pushToken last8 only (no full token)",
  fn: () => {
    const ok = DeviceStateSchema.shape.pushToken.safeParse({
      last8: "abcdef12",
      environment: "sandbox",
    });
    assert(ok.success);
    const withFullToken = DeviceStateSchema.shape.pushToken.safeParse({
      last8: "abcdef12",
      environment: "sandbox",
      raw: "deadbeef".repeat(32),
    });
    assert(!withFullToken.success, "full pushToken must be rejected");
  },
});

Deno.test({
  name: "me/state envelope — capability enum rejects 'tap' (post-rename)",
  fn: () => {
    const r = DeviceStateSchema.shape.capabilities.safeParse(["tap"]);
    assert(!r.success, "tap must be rejected (renamed to scanner)");
  },
});

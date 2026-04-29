/**
 * GET /api/admin/devices/{deviceId}/session — handler-direct unit tests.
 */

import { assert, assertEquals } from "@std/assert";
import {
  _resetSessionTestSeams,
  _setActiveTxnFinderForTests,
  _setChargerLoaderForTests,
  _setCustomerLabelLoaderForTests,
  _setMeterTotalsLoaderForTests,
  handler,
} from "./session.ts";

const CHARGER_ID = "BAY-3";
const URL_BASE =
  `https://manage.example.com/api/admin/devices/${CHARGER_ID}/session`;
const DEVICE_UUID = "11111111-2222-3333-4444-555555555555";
const OWNER_USER_ID = "owner-user-1";

function deviceState(caps: string[]) {
  return {
    device: {
      id: DEVICE_UUID,
      ownerUserId: OWNER_USER_ID,
      capabilities: caps,
      secret: "x",
      tokenId: "tok",
    },
  };
}

async function callGet(opts: {
  state?: ReturnType<typeof deviceState> | Record<string, never>;
} = {}): Promise<Response> {
  const req = new Request(URL_BASE, { method: "GET" });
  // deno-lint-ignore no-explicit-any
  const get = (handler as any).GET as (ctx: {
    req: Request;
    state: unknown;
    params: { deviceId: string };
  }) => Promise<Response>;
  return await get({
    req,
    state: opts.state ?? {},
    params: { deviceId: CHARGER_ID },
  });
}

function chargerOnline(status: string = "Available") {
  _setChargerLoaderForTests(() =>
    Promise.resolve({
      chargeBoxId: CHARGER_ID,
      chargeBoxPk: 1,
      friendlyName: "Bay 3",
      lastSeenAt: new Date(),
      lastStatus: status,
      lastStatusAt: new Date(),
    })
  );
}

Deno.test({
  name: "session-GET — 401 without bearer",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetSessionTestSeams();
    const res = await callGet({});
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "session-GET — 403 without `user`",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetSessionTestSeams();
    const res = await callGet({ state: deviceState(["scanner"]) });
    assertEquals(res.status, 403);
  },
});

Deno.test({
  name: "session-GET — 404 when charger row absent",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetSessionTestSeams();
    _setChargerLoaderForTests(() => Promise.resolve(null));
    const res = await callGet({ state: deviceState(["user"]) });
    assertEquals(res.status, 404);
    _resetSessionTestSeams();
  },
});

Deno.test({
  name: "session-GET — 200 with null body when no active session",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetSessionTestSeams();
    chargerOnline("Available");
    _setActiveTxnFinderForTests(() => Promise.resolve(null));
    const res = await callGet({ state: deviceState(["user"]) });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.session, null);
    assertEquals(body.state, "idle");
    assertEquals(body.chargerId, CHARGER_ID);
    _resetSessionTestSeams();
  },
});

Deno.test({
  name: "session-GET — 200 with full session shape when active",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetSessionTestSeams();
    chargerOnline("Charging");
    const startedAt = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
    _setActiveTxnFinderForTests(() =>
      Promise.resolve({
        id: 555,
        chargeBoxId: CHARGER_ID,
        chargeBoxPk: 1,
        connectorId: 1,
        ocppIdTag: "AAAA0001",
        ocppTagPk: 99,
        startTimestamp: startedAt.toISOString(),
        startValue: "0",
        stopTimestamp: null,
        stopValue: null,
        stopEventActor: null,
        stopReason: null,
      })
    );
    _setCustomerLabelLoaderForTests(() =>
      Promise.resolve({ label: "Alice", lagoSubscriptionExternalId: null })
    );
    _setMeterTotalsLoaderForTests(() =>
      Promise.resolve({ kwh: 5.0, lastSyncedAt: new Date() })
    );
    const res = await callGet({ state: deviceState(["user"]) });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.session.chargerId, CHARGER_ID);
    assertEquals(body.session.sessionId, "555");
    assertEquals(body.session.idTag, "AAAA0001");
    assertEquals(body.session.customerName, "Alice");
    assertEquals(body.session.connectorId, 1);
    assertEquals(body.state, "charging");
    assertEquals(body.session.kwh, 5.0);
    // ~10 kW (5 kWh / 0.5h)
    assert(typeof body.session.kw === "number" && body.session.kw! > 0);
    assert(typeof body.session.elapsedSec === "number");
    _resetSessionTestSeams();
  },
});

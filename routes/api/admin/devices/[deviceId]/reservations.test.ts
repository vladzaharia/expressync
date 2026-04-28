/**
 * GET /api/admin/devices/{deviceId}/reservations — handler-direct unit tests.
 */

import { assertEquals } from "@std/assert";
import {
  _resetReservationsTestSeams,
  _setChargerLoaderForTests,
  _setCustomerLabelsLoaderForTests,
  _setReservationsLoaderForTests,
  handler,
} from "./reservations.ts";

const CHARGER_ID = "BAY-3";
const URL_BASE =
  `https://manage.example.com/api/admin/devices/${CHARGER_ID}/reservations`;
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

function chargerOnline() {
  _setChargerLoaderForTests(() =>
    Promise.resolve({
      chargeBoxId: CHARGER_ID,
      chargeBoxPk: 1,
      friendlyName: null,
      lastSeenAt: new Date(),
      lastStatus: "Available",
      lastStatusAt: new Date(),
    })
  );
}

Deno.test({
  name: "reservations-GET — 401 without bearer",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetReservationsTestSeams();
    const res = await callGet({});
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "reservations-GET — 403 without `user`",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetReservationsTestSeams();
    const res = await callGet({ state: deviceState(["scanner"]) });
    assertEquals(res.status, 403);
  },
});

Deno.test({
  name: "reservations-GET — 404 when charger absent",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetReservationsTestSeams();
    _setChargerLoaderForTests(() => Promise.resolve(null));
    const res = await callGet({ state: deviceState(["user"]) });
    assertEquals(res.status, 404);
    _resetReservationsTestSeams();
  },
});

Deno.test({
  name: "reservations-GET — 200 returns shaped rows incl. blackout",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetReservationsTestSeams();
    chargerOnline();
    const start1 = new Date("2026-04-28T10:00:00Z");
    const end1 = new Date("2026-04-28T11:00:00Z");
    const start2 = new Date("2026-04-28T12:00:00Z");
    const end2 = new Date("2026-04-28T13:00:00Z");
    _setReservationsLoaderForTests(() =>
      Promise.resolve([
        {
          id: 10,
          steveOcppTagPk: 99,
          steveOcppIdTag: "AAAA0001",
          startAt: start1,
          endAt: end1,
          status: "pending",
        },
        {
          id: 11,
          steveOcppTagPk: -1,
          steveOcppIdTag: "admin-blackout",
          startAt: start2,
          endAt: end2,
          status: "confirmed",
        },
      ])
    );
    _setCustomerLabelsLoaderForTests((pks) => {
      const m = new Map<number, string | null>();
      for (const pk of pks) m.set(pk, pk === 99 ? "Alice" : null);
      return Promise.resolve(m);
    });
    const res = await callGet({ state: deviceState(["user"]) });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.reservations.length, 2);
    assertEquals(body.reservations[0].reservationId, "10");
    assertEquals(body.reservations[0].customerLabel, "Alice");
    assertEquals(body.reservations[0].isBlackout, false);
    assertEquals(body.reservations[0].idTag, "AAAA0001");
    assertEquals(body.reservations[0].isCancelable, true);
    assertEquals(body.reservations[1].isBlackout, true);
    assertEquals(body.reservations[1].customerLabel, null);
    assertEquals(body.reservations[1].idTag, null);
    _resetReservationsTestSeams();
  },
});

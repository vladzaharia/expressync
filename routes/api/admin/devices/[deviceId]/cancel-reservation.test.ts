/**
 * DELETE /api/admin/devices/{deviceId}/cancel-reservation — handler-direct
 * unit tests.
 */

import { assertEquals } from "@std/assert";
import {
  _resetCancelReservationTestSeams,
  _setReservationCancellerForTests,
  _setReservationLookupForTests,
  handler,
} from "./cancel-reservation.ts";
import {
  _resetChargerOnlineTestSeams,
  _setChargerLoaderForTests,
} from "../../../../../src/lib/chargers/online.ts";

const CHARGER_ID = "BAY-3";
const URL_BASE =
  `https://manage.example.com/api/admin/devices/${CHARGER_ID}/cancel-reservation`;
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

async function callDelete(opts: {
  state?: ReturnType<typeof deviceState> | Record<string, never>;
  body?: unknown;
} = {}): Promise<Response> {
  const req = new Request(URL_BASE, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: typeof opts.body === "string"
      ? opts.body
      : JSON.stringify(opts.body ?? {}),
  });
  // deno-lint-ignore no-explicit-any
  const del = (handler as any).DELETE as (ctx: {
    req: Request;
    state: unknown;
    params: { deviceId: string };
  }) => Promise<Response>;
  return await del({
    req,
    state: opts.state ?? {},
    params: { deviceId: CHARGER_ID },
  });
}

function onlineLoader() {
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

function offlineLoader() {
  _setChargerLoaderForTests(() =>
    Promise.resolve({
      chargeBoxId: CHARGER_ID,
      chargeBoxPk: 1,
      friendlyName: null,
      lastSeenAt: new Date(Date.now() - 10 * 60 * 1000),
      lastStatus: "Available",
      lastStatusAt: new Date(Date.now() - 10 * 60 * 1000),
    })
  );
}

Deno.test({
  name: "cancel-reservation-DELETE — 401 without bearer",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCancelReservationTestSeams();
    _resetChargerOnlineTestSeams();
    const res = await callDelete({});
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "cancel-reservation-DELETE — 403 without `user`",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCancelReservationTestSeams();
    _resetChargerOnlineTestSeams();
    const res = await callDelete({
      state: deviceState(["scanner"]),
      body: { reservationId: "1" },
    });
    assertEquals(res.status, 403);
  },
});

Deno.test({
  name:
    "cancel-reservation-DELETE — 400 invalid_body when reservationId missing",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCancelReservationTestSeams();
    _resetChargerOnlineTestSeams();
    const res = await callDelete({
      state: deviceState(["user"]),
      body: {},
    });
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name: "cancel-reservation-DELETE — 409 charger_offline",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCancelReservationTestSeams();
    _resetChargerOnlineTestSeams();
    offlineLoader();
    const res = await callDelete({
      state: deviceState(["user"]),
      body: { reservationId: "1" },
    });
    assertEquals(res.status, 409);
    const body = await res.json();
    assertEquals(body.error, "charger_offline");
    _resetChargerOnlineTestSeams();
  },
});

Deno.test({
  name:
    "cancel-reservation-DELETE — 404 reservation_not_found when row missing",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCancelReservationTestSeams();
    _resetChargerOnlineTestSeams();
    onlineLoader();
    _setReservationLookupForTests(() => Promise.resolve(null));
    const res = await callDelete({
      state: deviceState(["user"]),
      body: { reservationId: "999" },
    });
    assertEquals(res.status, 404);
    _resetCancelReservationTestSeams();
    _resetChargerOnlineTestSeams();
  },
});

Deno.test({
  name:
    "cancel-reservation-DELETE — 404 when reservation belongs to a different charger",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCancelReservationTestSeams();
    _resetChargerOnlineTestSeams();
    onlineLoader();
    _setReservationLookupForTests(() =>
      Promise.resolve({ id: 5, chargeBoxId: "BAY-1", status: "pending" })
    );
    const res = await callDelete({
      state: deviceState(["user"]),
      body: { reservationId: "5" },
    });
    assertEquals(res.status, 404);
    _resetCancelReservationTestSeams();
    _resetChargerOnlineTestSeams();
  },
});

Deno.test({
  name: "cancel-reservation-DELETE — 409 already_cancelled",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCancelReservationTestSeams();
    _resetChargerOnlineTestSeams();
    onlineLoader();
    _setReservationLookupForTests(() =>
      Promise.resolve({
        id: 5,
        chargeBoxId: CHARGER_ID,
        status: "cancelled",
      })
    );
    const res = await callDelete({
      state: deviceState(["user"]),
      body: { reservationId: "5" },
    });
    assertEquals(res.status, 409);
    const body = await res.json();
    assertEquals(body.error, "already_cancelled");
    _resetCancelReservationTestSeams();
    _resetChargerOnlineTestSeams();
  },
});

Deno.test({
  name: "cancel-reservation-DELETE — 200 happy path cancels + audits",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCancelReservationTestSeams();
    _resetChargerOnlineTestSeams();
    onlineLoader();
    _setReservationLookupForTests(() =>
      Promise.resolve({
        id: 7,
        chargeBoxId: CHARGER_ID,
        status: "pending",
      })
    );
    let cancelledId: number | null = null;
    _setReservationCancellerForTests((id) => {
      cancelledId = id;
      return Promise.resolve({ id, status: "cancelled" });
    });
    const res = await callDelete({
      state: deviceState(["user"]),
      body: { reservationId: "7" },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.reservationId, 7);
    assertEquals(body.status, "cancelled");
    assertEquals(cancelledId, 7);
    _resetCancelReservationTestSeams();
    _resetChargerOnlineTestSeams();
  },
});

Deno.test({
  name: "cancel-reservation-DELETE — 400 strict body rejects unknown fields",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCancelReservationTestSeams();
    _resetChargerOnlineTestSeams();
    const res = await callDelete({
      state: deviceState(["user"]),
      body: { reservationId: "1", evil: "yes" },
    });
    assertEquals(res.status, 400);
  },
});

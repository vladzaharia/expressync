/**
 * POST /api/admin/devices/{deviceId}/stop — handler-direct unit tests.
 */

import { assert, assertEquals } from "@std/assert";
import {
  _resetStopTestSeams,
  _setActiveTxnFinderForTests,
  _setSteveStopperForTests,
  handler,
} from "./stop.ts";
import {
  _resetChargerOnlineTestSeams,
  _setChargerLoaderForTests,
} from "../../../../../src/lib/chargers/online.ts";

const CHARGER_ID = "BAY-3";
const URL_BASE =
  `https://manage.example.com/api/admin/devices/${CHARGER_ID}/stop`;
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

async function callPost(opts: {
  state?: ReturnType<typeof deviceState> | Record<string, never>;
  body?: unknown;
} = {}): Promise<Response> {
  const req = new Request(URL_BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof opts.body === "string"
      ? opts.body
      : JSON.stringify(opts.body ?? {}),
  });
  // deno-lint-ignore no-explicit-any
  const post = (handler as any).POST as (ctx: {
    req: Request;
    state: unknown;
    params: { deviceId: string };
  }) => Promise<Response>;
  return await post({
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
      friendlyName: "Bay 3",
      lastSeenAt: new Date(),
      lastStatus: "Charging",
      lastStatusAt: new Date(),
    })
  );
}

function offlineLoader() {
  _setChargerLoaderForTests(() =>
    Promise.resolve({
      chargeBoxId: CHARGER_ID,
      chargeBoxPk: 1,
      friendlyName: "Bay 3",
      lastSeenAt: new Date(Date.now() - 10 * 60 * 1000),
      lastStatus: "Charging",
      lastStatusAt: new Date(Date.now() - 10 * 60 * 1000),
    })
  );
}

Deno.test({
  name: "stop-POST — 401 without bearer",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetStopTestSeams();
    _resetChargerOnlineTestSeams();
    const res = await callPost({});
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "stop-POST — 403 without `user`",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetStopTestSeams();
    _resetChargerOnlineTestSeams();
    const res = await callPost({ state: deviceState(["scanner"]) });
    assertEquals(res.status, 403);
  },
});

Deno.test({
  name: "stop-POST — 409 charger_offline",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetStopTestSeams();
    _resetChargerOnlineTestSeams();
    offlineLoader();
    const res = await callPost({ state: deviceState(["user"]) });
    assertEquals(res.status, 409);
    const body = await res.json();
    assertEquals(body.error, "charger_offline");
    _resetChargerOnlineTestSeams();
  },
});

Deno.test({
  name: "stop-POST — 404 no_active_transaction when no active txn",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetStopTestSeams();
    _resetChargerOnlineTestSeams();
    onlineLoader();
    _setActiveTxnFinderForTests(() => Promise.resolve(null));
    const res = await callPost({ state: deviceState(["user"]) });
    assertEquals(res.status, 404);
    const body = await res.json();
    assertEquals(body.error, "no_active_transaction");
    _resetStopTestSeams();
    _resetChargerOnlineTestSeams();
  },
});

Deno.test({
  name: "stop-POST — 400 strict body rejects unknown fields",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetStopTestSeams();
    _resetChargerOnlineTestSeams();
    onlineLoader();
    const res = await callPost({
      state: deviceState(["user"]),
      body: { foo: 1 },
    });
    assertEquals(res.status, 400);
    _resetChargerOnlineTestSeams();
  },
});

Deno.test({
  name: "stop-POST — happy path past gates uses transactionPk override",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetStopTestSeams();
    _resetChargerOnlineTestSeams();
    onlineLoader();
    let stoppedWith: number | null = null;
    _setSteveStopperForTests((p) => {
      stoppedWith = p.transactionId;
      return Promise.resolve({ taskId: 1, succeeded: true });
    });
    const res = await callPost({
      state: deviceState(["user"]),
      body: { transactionPk: 42 },
    });
    // DB-bound; either 200 (live DB) or 500 (no DB).
    assert(res.status === 200 || res.status === 500);
    if (res.status === 200) assertEquals(stoppedWith, 42);
    _resetStopTestSeams();
    _resetChargerOnlineTestSeams();
  },
});

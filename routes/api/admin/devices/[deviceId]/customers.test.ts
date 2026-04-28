/**
 * GET /api/admin/devices/{deviceId}/customers — handler-direct unit tests.
 */

import { assert, assertEquals } from "@std/assert";
import {
  _resetCustomersTestSeams,
  _setChargerExistsCheckForTests,
  _setCustomersLoaderForTests,
  _setOwnerLagoLoaderForTests,
  handler,
} from "./customers.ts";

const CHARGER_ID = "BAY-3";
const URL_BASE =
  `https://manage.example.com/api/admin/devices/${CHARGER_ID}/customers`;
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
  pathChargerId?: string;
}): Promise<Response> {
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
    params: { deviceId: opts.pathChargerId ?? CHARGER_ID },
  });
}

Deno.test({
  name: "customers-GET — 401 without bearer",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCustomersTestSeams();
    const res = await callGet({ state: {} });
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "customers-GET — 403 without `user` capability",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCustomersTestSeams();
    const res = await callGet({ state: deviceState(["scanner"]) });
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.error, "capability_denied");
    _resetCustomersTestSeams();
  },
});

Deno.test({
  name: "customers-GET — 404 when chargerId unknown",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCustomersTestSeams();
    _setChargerExistsCheckForTests(() => Promise.resolve(false));
    const res = await callGet({ state: deviceState(["user"]) });
    assertEquals(res.status, 404);
    _resetCustomersTestSeams();
  },
});

Deno.test({
  name:
    "customers-GET — 200 happy path; recency sort, then alpha; isOwn marks owner",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCustomersTestSeams();
    _setChargerExistsCheckForTests(() => Promise.resolve(true));
    _setOwnerLagoLoaderForTests(() => Promise.resolve("lago-owner"));
    _setCustomersLoaderForTests(() =>
      Promise.resolve([
        // No name + no email → falls back to userId for displayName
        {
          lagoCustomerExternalId: "lago-anon",
          userId: "user-anon",
          name: null,
          email: null,
          lastUsedAt: null,
        },
        {
          lagoCustomerExternalId: "lago-owner",
          userId: "user-alice",
          name: "Alice",
          email: "alice@example.com",
          lastUsedAt: new Date("2026-04-01T00:00:00Z"),
        },
        {
          lagoCustomerExternalId: "lago-bob",
          userId: "user-bob",
          name: "Bob",
          email: "bob@example.com",
          lastUsedAt: new Date("2026-04-15T00:00:00Z"),
        },
      ])
    );
    const res = await callGet({ state: deviceState(["user"]) });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.customers.length, 3);
    // Most-recent first (Bob, Alice), unused last (anon).
    assertEquals(body.customers[0].lagoCustomerExternalId, "lago-bob");
    assertEquals(body.customers[0].displayName, "Bob");
    assertEquals(body.customers[0].isOwn, false);
    assertEquals(body.customers[1].lagoCustomerExternalId, "lago-owner");
    assertEquals(body.customers[1].isOwn, true);
    assertEquals(body.customers[1].displayName, "Alice");
    assertEquals(body.customers[2].displayName, "user-anon"); // userId fallback
    assert(typeof body.customers[1].lastUsedAt === "string");
    assertEquals(body.customers[2].lastUsedAt, null);
    _resetCustomersTestSeams();
  },
});

Deno.test({
  name: "customers-GET — displayName picks email when name is missing",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCustomersTestSeams();
    _setChargerExistsCheckForTests(() => Promise.resolve(true));
    _setOwnerLagoLoaderForTests(() => Promise.resolve(null));
    _setCustomersLoaderForTests(() =>
      Promise.resolve([
        {
          lagoCustomerExternalId: "lago-x",
          userId: "user-x",
          name: null,
          email: "x@example.com",
          lastUsedAt: null,
        },
      ])
    );
    const res = await callGet({ state: deviceState(["user"]) });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.customers[0].displayName, "x@example.com");
    assertEquals(body.customers[0].name, null);
    assertEquals(body.customers[0].email, "x@example.com");
    _resetCustomersTestSeams();
  },
});

Deno.test({
  name: "customers-GET — 404 when chargerId is empty",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCustomersTestSeams();
    const res = await callGet({
      state: deviceState(["user"]),
      pathChargerId: "",
    });
    assertEquals(res.status, 404);
    _resetCustomersTestSeams();
  },
});

/**
 * GET /api/admin/devices/{deviceId}/tags — handler-direct unit tests.
 */

import { assert, assertEquals } from "@std/assert";
import {
  _resetTagsTestSeams,
  _setChargerExistsCheckForTests,
  _setOwnerLagoLoaderForTests,
  _setTagsLoaderForTests,
  handler,
} from "./tags.ts";

const CHARGER_ID = "BAY-3";
const URL_BASE =
  `https://manage.example.com/api/admin/devices/${CHARGER_ID}/tags`;
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
  name: "tags-GET — 401 without bearer",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetTagsTestSeams();
    const res = await callGet({ state: {} });
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "tags-GET — 403 without `user` capability",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetTagsTestSeams();
    const res = await callGet({ state: deviceState(["scanner"]) });
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.error, "capability_denied");
    _resetTagsTestSeams();
  },
});

Deno.test({
  name: "tags-GET — 404 when chargerId is unknown",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetTagsTestSeams();
    _setChargerExistsCheckForTests(() => Promise.resolve(false));
    const res = await callGet({ state: deviceState(["user"]) });
    assertEquals(res.status, 404);
    _resetTagsTestSeams();
  },
});

Deno.test({
  name:
    "tags-GET — 200 happy path; sorted by recency, then alpha; isOwn marks owner",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetTagsTestSeams();
    _setChargerExistsCheckForTests(() => Promise.resolve(true));
    _setOwnerLagoLoaderForTests(() => Promise.resolve("lago-owner"));
    _setTagsLoaderForTests(() =>
      Promise.resolve([
        {
          tagPk: 1,
          idTag: "AAAA0001",
          customerId: "lago-other",
          customerName: "Bob",
          lastUsedAt: null,
        },
        {
          tagPk: 2,
          idTag: "BBBB0002",
          customerId: "lago-owner",
          customerName: "Alice",
          lastUsedAt: new Date("2026-04-01T00:00:00Z"),
        },
        {
          tagPk: 3,
          idTag: "CCCC0003",
          customerId: "lago-other",
          customerName: "Carol",
          lastUsedAt: new Date("2026-04-15T00:00:00Z"),
        },
      ])
    );
    const res = await callGet({ state: deviceState(["user"]) });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.tags.length, 3);
    // Most-recent first (Carol, Alice), unused last (Bob).
    assertEquals(body.tags[0].idTag, "CCCC0003");
    assertEquals(body.tags[0].customerName, "Carol");
    assertEquals(body.tags[0].isOwn, false);
    assertEquals(body.tags[1].idTag, "BBBB0002");
    assertEquals(body.tags[1].customerName, "Alice");
    assertEquals(body.tags[1].isOwn, true);
    assertEquals(body.tags[2].idTag, "AAAA0001");
    assertEquals(body.tags[2].lastUsedAt, null);
    assert(typeof body.tags[1].lastUsedAt === "string");
    _resetTagsTestSeams();
  },
});

Deno.test({
  name: "tags-GET — 404 when chargerId is empty",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetTagsTestSeams();
    const res = await callGet({
      state: deviceState(["user"]),
      pathChargerId: "",
    });
    assertEquals(res.status, 404);
    _resetTagsTestSeams();
  },
});

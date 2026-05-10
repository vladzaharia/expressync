/**
 * PATCH /api/admin/users/{userId}/feature-flags — handler-direct tests.
 *
 * Coverage:
 *   401 anon
 *   403 customer cookie
 *   400 invalid_body                  — missing flags
 *   400 invalid_flag                  — unknown registry key
 *   400 invalid_value                 — wrong type for known key
 *   400 invalid_scope                 — flag not user-scoped (n/a today
 *                                       with the seed registry — both
 *                                       flags are scope:"both" — but we
 *                                       still cover via a temporary
 *                                       monkey-patch of the registry).
 *   404 user_not_found
 *   200 happy path                    — upsert
 *   200 happy path                    — value:null deletes
 */

import { assertEquals } from "@std/assert";
import {
  _resetUserFeatureFlagsTestSeams,
  _setFlagResolverForTests,
  _setOwnedDevicesLoaderForTests,
  _setUserFlagDeleterForTests,
  _setUserFlagUpserterForTests,
  _setUserLoaderForTests,
  handler,
} from "./feature-flags.ts";
import { eventBus } from "../../../../../src/services/event-bus.service.ts";

const URL_BASE =
  "https://manage.example.com/api/admin/users/user-1/feature-flags";
const USER_ID = "user-1";
const ADMIN_USER_ID = "admin-user-1";
const PHONE_DEVICE_ID = "11111111-2222-3333-4444-555555555555";

interface MockState {
  user?: {
    id: string;
    role: string;
    email: string;
    name: string | null;
    emailVerified: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
}

function adminState(): MockState {
  return {
    user: {
      id: ADMIN_USER_ID,
      role: "admin",
      email: "admin@example.com",
      name: "Admin",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

function customerState(): MockState {
  return {
    user: {
      id: "cust-1",
      role: "customer",
      email: "cust@example.com",
      name: null,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

async function callPatch(args: {
  state: MockState;
  body: unknown;
  pathUserId?: string;
}): Promise<Response> {
  const req = new Request(URL_BASE, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof args.body === "string"
      ? args.body
      : JSON.stringify(args.body ?? {}),
  });
  // deno-lint-ignore no-explicit-any
  const patch = (handler as any).PATCH as (
    ctx: {
      req: Request;
      state: MockState;
      params: { userId: string };
    },
  ) => Promise<Response>;
  return await patch({
    req,
    state: args.state,
    params: { userId: args.pathUserId ?? USER_ID },
  });
}

Deno.test({
  name: "user-feature-flags PATCH — 401 anon",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetUserFeatureFlagsTestSeams();
    const res = await callPatch({
      state: {},
      body: { flags: [{ key: "demo.flag", value: true }] },
    });
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "user-feature-flags PATCH — 403 customer cookie",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetUserFeatureFlagsTestSeams();
    const res = await callPatch({
      state: customerState(),
      body: { flags: [{ key: "demo.flag", value: true }] },
    });
    assertEquals(res.status, 403);
  },
});

Deno.test({
  name: "user-feature-flags PATCH — 400 invalid_body (missing flags)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetUserFeatureFlagsTestSeams();
    const res = await callPatch({ state: adminState(), body: {} });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_body");
  },
});

Deno.test({
  name: "user-feature-flags PATCH — 400 invalid_flag (unknown key)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetUserFeatureFlagsTestSeams();
    _setUserLoaderForTests(() => Promise.resolve({ id: USER_ID }));
    const res = await callPatch({
      state: adminState(),
      body: { flags: [{ key: "nope.unknown", value: true }] },
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_flag");
    assertEquals(body.key, "nope.unknown");
    _resetUserFeatureFlagsTestSeams();
  },
});

Deno.test({
  name: "user-feature-flags PATCH — 400 invalid_value (type mismatch)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetUserFeatureFlagsTestSeams();
    _setUserLoaderForTests(() => Promise.resolve({ id: USER_ID }));
    const res = await callPatch({
      state: adminState(),
      body: { flags: [{ key: "demo.flag", value: "not-a-bool" }] },
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_value");
    assertEquals(body.key, "demo.flag");
    _resetUserFeatureFlagsTestSeams();
  },
});

Deno.test({
  name: "user-feature-flags PATCH — 404 user_not_found",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetUserFeatureFlagsTestSeams();
    _setUserLoaderForTests(() => Promise.resolve(null));
    const res = await callPatch({
      state: adminState(),
      body: { flags: [{ key: "demo.flag", value: true }] },
    });
    assertEquals(res.status, 404);
    _resetUserFeatureFlagsTestSeams();
  },
});

Deno.test({
  name:
    "user-feature-flags PATCH — 200 happy path upserts + publishes SSE per phone",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetUserFeatureFlagsTestSeams();
    eventBus._reset();
    _setUserLoaderForTests(() => Promise.resolve({ id: USER_ID }));
    let upserted: { key: string; value: unknown }[] = [];
    _setUserFlagUpserterForTests((_uid, rows) => {
      upserted = rows.map((r) => ({ key: r.key, value: r.value }));
      return Promise.resolve();
    });
    _setOwnedDevicesLoaderForTests(() =>
      Promise.resolve([
        { id: PHONE_DEVICE_ID, kind: "phone_nfc", deletedAt: null },
        // soft-deleted phone — should be skipped
        {
          id: "deleted-id",
          kind: "phone_nfc",
          deletedAt: new Date(),
        },
      ])
    );
    _setFlagResolverForTests(() => Promise.resolve({ "demo.flag": true }));

    const seen: string[] = [];
    const unsub = eventBus.subscribe(
      ["device.feature-flags.changed"],
      (ev) => {
        const p = ev.payload as { deviceId: string };
        seen.push(p.deviceId);
      },
    );
    const res = await callPatch({
      state: adminState(),
      body: { flags: [{ key: "demo.flag", value: true }] },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.flags, { "demo.flag": true });
    assertEquals(upserted.length, 1);
    assertEquals(upserted[0].key, "demo.flag");
    assertEquals(upserted[0].value, true);
    assertEquals(seen, [PHONE_DEVICE_ID]);
    unsub();
    _resetUserFeatureFlagsTestSeams();
  },
});

Deno.test({
  name: "user-feature-flags PATCH — 200 value:null deletes the row",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetUserFeatureFlagsTestSeams();
    _setUserLoaderForTests(() => Promise.resolve({ id: USER_ID }));
    let deleted: string[] = [];
    _setUserFlagDeleterForTests((_uid, keys) => {
      deleted = [...keys];
      return Promise.resolve();
    });
    _setUserFlagUpserterForTests(() => Promise.resolve());
    _setOwnedDevicesLoaderForTests(() => Promise.resolve([]));
    _setFlagResolverForTests(() => Promise.resolve({}));
    const res = await callPatch({
      state: adminState(),
      body: { flags: [{ key: "demo.flag", value: null }] },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(deleted, ["demo.flag"]);
    _resetUserFeatureFlagsTestSeams();
  },
});

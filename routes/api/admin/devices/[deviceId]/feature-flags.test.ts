/**
 * PATCH /api/admin/devices/{deviceId}/feature-flags — handler-direct tests.
 */

import { assertEquals } from "@std/assert";
import {
  _resetDeviceFeatureFlagsTestSeams,
  _setDeviceFlagDeleterForTests,
  _setDeviceFlagUpserterForTests,
  _setDeviceLoaderForTests,
  _setFlagResolverForTests,
  handler,
} from "./feature-flags.ts";
import { eventBus } from "../../../../../src/services/event-bus.service.ts";

const URL_BASE =
  "https://manage.example.com/api/admin/devices/11111111-2222-3333-4444-555555555555/feature-flags";
const DEVICE_UUID = "11111111-2222-3333-4444-555555555555";
const ADMIN_USER_ID = "admin-user-1";
const OWNER_USER_ID = "owner-user-1";

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
  pathDeviceId?: string;
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
      params: { deviceId: string };
    },
  ) => Promise<Response>;
  return await patch({
    req,
    state: args.state,
    params: { deviceId: args.pathDeviceId ?? DEVICE_UUID },
  });
}

Deno.test({
  name: "device-feature-flags PATCH — 401 anon",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetDeviceFeatureFlagsTestSeams();
    const res = await callPatch({
      state: {},
      body: { flags: [{ key: "demo.flag", value: true }] },
    });
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "device-feature-flags PATCH — 403 customer cookie",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetDeviceFeatureFlagsTestSeams();
    const res = await callPatch({
      state: customerState(),
      body: { flags: [{ key: "demo.flag", value: true }] },
    });
    assertEquals(res.status, 403);
  },
});

Deno.test({
  name: "device-feature-flags PATCH — 400 invalid_body (missing flags)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetDeviceFeatureFlagsTestSeams();
    const res = await callPatch({ state: adminState(), body: {} });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_body");
  },
});

Deno.test({
  name: "device-feature-flags PATCH — 422 charger-kind device unsupported",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetDeviceFeatureFlagsTestSeams();
    _setDeviceLoaderForTests(() =>
      Promise.resolve({
        id: DEVICE_UUID,
        kind: "charger",
        ownerUserId: OWNER_USER_ID,
        deletedAt: null,
      })
    );
    const res = await callPatch({
      state: adminState(),
      body: { flags: [{ key: "demo.flag", value: true }] },
    });
    assertEquals(res.status, 422);
    const body = await res.json();
    assertEquals(body.error, "device_kind_unsupported");
    _resetDeviceFeatureFlagsTestSeams();
  },
});

Deno.test({
  name: "device-feature-flags PATCH — 404 device not found",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetDeviceFeatureFlagsTestSeams();
    _setDeviceLoaderForTests(() => Promise.resolve(null));
    const res = await callPatch({
      state: adminState(),
      body: { flags: [{ key: "demo.flag", value: true }] },
    });
    assertEquals(res.status, 404);
    _resetDeviceFeatureFlagsTestSeams();
  },
});

Deno.test({
  name: "device-feature-flags PATCH — 410 soft-deleted device",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetDeviceFeatureFlagsTestSeams();
    _setDeviceLoaderForTests(() =>
      Promise.resolve({
        id: DEVICE_UUID,
        kind: "phone_nfc",
        ownerUserId: OWNER_USER_ID,
        deletedAt: new Date(),
      })
    );
    const res = await callPatch({
      state: adminState(),
      body: { flags: [{ key: "demo.flag", value: true }] },
    });
    assertEquals(res.status, 410);
    _resetDeviceFeatureFlagsTestSeams();
  },
});

Deno.test({
  name: "device-feature-flags PATCH — 400 invalid_flag (unknown key)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetDeviceFeatureFlagsTestSeams();
    _setDeviceLoaderForTests(() =>
      Promise.resolve({
        id: DEVICE_UUID,
        kind: "phone_nfc",
        ownerUserId: OWNER_USER_ID,
        deletedAt: null,
      })
    );
    const res = await callPatch({
      state: adminState(),
      body: { flags: [{ key: "nope.unknown", value: true }] },
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_flag");
    _resetDeviceFeatureFlagsTestSeams();
  },
});

Deno.test({
  name: "device-feature-flags PATCH — 400 invalid_value (type mismatch)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetDeviceFeatureFlagsTestSeams();
    _setDeviceLoaderForTests(() =>
      Promise.resolve({
        id: DEVICE_UUID,
        kind: "phone_nfc",
        ownerUserId: OWNER_USER_ID,
        deletedAt: null,
      })
    );
    const res = await callPatch({
      state: adminState(),
      body: { flags: [{ key: "demo.flag", value: 42 }] },
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_value");
    _resetDeviceFeatureFlagsTestSeams();
  },
});

Deno.test({
  name: "device-feature-flags PATCH — 200 happy path upserts + publishes SSE",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetDeviceFeatureFlagsTestSeams();
    eventBus._reset();
    _setDeviceLoaderForTests(() =>
      Promise.resolve({
        id: DEVICE_UUID,
        kind: "phone_nfc",
        ownerUserId: OWNER_USER_ID,
        deletedAt: null,
      })
    );
    let upserted: { key: string; value: unknown }[] = [];
    _setDeviceFlagUpserterForTests((_did, rows) => {
      upserted = rows.map((r) => ({ key: r.key, value: r.value }));
      return Promise.resolve();
    });
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
    assertEquals(upserted, [{ key: "demo.flag", value: true }]);
    assertEquals(seen, [DEVICE_UUID]);
    unsub();
    _resetDeviceFeatureFlagsTestSeams();
  },
});

Deno.test({
  name: "device-feature-flags PATCH — 200 value:null deletes",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetDeviceFeatureFlagsTestSeams();
    _setDeviceLoaderForTests(() =>
      Promise.resolve({
        id: DEVICE_UUID,
        kind: "phone_nfc",
        ownerUserId: OWNER_USER_ID,
        deletedAt: null,
      })
    );
    let deleted: string[] = [];
    _setDeviceFlagUpserterForTests(() => Promise.resolve());
    _setDeviceFlagDeleterForTests((_did, keys) => {
      deleted = [...keys];
      return Promise.resolve();
    });
    _setFlagResolverForTests(() => Promise.resolve({}));
    const res = await callPatch({
      state: adminState(),
      body: { flags: [{ key: "demo.flag", value: null }] },
    });
    assertEquals(res.status, 200);
    assertEquals(deleted, ["demo.flag"]);
    _resetDeviceFeatureFlagsTestSeams();
  },
});

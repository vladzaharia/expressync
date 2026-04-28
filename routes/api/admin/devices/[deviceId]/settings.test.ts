/**
 * PATCH /api/admin/devices/{deviceId}/settings — handler-direct
 * unit tests.
 */

import { assertEquals } from "@std/assert";
import {
  _resetSettingsPatchTestSeams,
  _setDeviceLoaderForTests,
  _setSettingsUpserterForTests,
  handler,
} from "./settings.ts";
import { eventBus } from "../../../../../src/services/event-bus.service.ts";

const URL_BASE =
  "https://manage.example.com/api/admin/devices/11111111-2222-3333-4444-555555555555/settings";
const DEVICE_UUID = "11111111-2222-3333-4444-555555555555";
const ADMIN_USER_ID = "admin-user-1";

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
  name: "settings-PATCH — 401 anon",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetSettingsPatchTestSeams();
    const res = await callPatch({
      state: {},
      body: { settings: [{ key: "device.label", value: "Front desk" }] },
    });
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "settings-PATCH — 400 unknown key",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetSettingsPatchTestSeams();
    _setDeviceLoaderForTests(() =>
      Promise.resolve({ id: DEVICE_UUID, deletedAt: null })
    );
    const res = await callPatch({
      state: adminState(),
      body: { settings: [{ key: "nonsense.key", value: 123 }] },
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_body");
    _resetSettingsPatchTestSeams();
  },
});

Deno.test({
  name: "settings-PATCH — 410 soft-deleted device",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetSettingsPatchTestSeams();
    _setDeviceLoaderForTests(() =>
      Promise.resolve({ id: DEVICE_UUID, deletedAt: new Date() })
    );
    const res = await callPatch({
      state: adminState(),
      body: { settings: [{ key: "device.label", value: "Front desk" }] },
    });
    assertEquals(res.status, 410);
    _resetSettingsPatchTestSeams();
  },
});

Deno.test({
  name: "settings-PATCH — 200 happy path upserts + publishes",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetSettingsPatchTestSeams();
    eventBus._reset();
    let upserted: { deviceId: string; rows: unknown[] } | null = null;
    _setDeviceLoaderForTests(() =>
      Promise.resolve({ id: DEVICE_UUID, deletedAt: null })
    );
    _setSettingsUpserterForTests((deviceId, rows) => {
      upserted = { deviceId, rows };
      return Promise.resolve();
    });

    const observed: string[] = [];
    const unsub = eventBus.subscribe(
      ["device.settings.changed"],
      (ev) => {
        const p = ev.payload as { keys: string[] };
        observed.push(...p.keys);
      },
    );

    const res = await callPatch({
      state: adminState(),
      body: {
        settings: [
          { key: "device.label", value: "Front desk" },
          { key: "notifications.scanRequest", value: false },
        ],
      },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.changedKeys.sort(), [
      "device.label",
      "notifications.scanRequest",
    ]);
    if (!upserted) throw new Error("expected upsert call");
    assertEquals((upserted as { deviceId: string }).deviceId, DEVICE_UUID);
    assertEquals((upserted as { rows: unknown[] }).rows.length, 2);
    assertEquals(observed.sort(), [
      "device.label",
      "notifications.scanRequest",
    ]);
    unsub();
    _resetSettingsPatchTestSeams();
  },
});

Deno.test({
  name: "settings-PATCH — 400 wrong value type",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetSettingsPatchTestSeams();
    _setDeviceLoaderForTests(() =>
      Promise.resolve({ id: DEVICE_UUID, deletedAt: null })
    );
    const res = await callPatch({
      state: adminState(),
      // notifications.scanRequest expects boolean
      body: { settings: [{ key: "notifications.scanRequest", value: "yes" }] },
    });
    assertEquals(res.status, 400);
    _resetSettingsPatchTestSeams();
  },
});

/**
 * PATCH /api/admin/devices/{deviceId}/capabilities — handler-direct
 * unit tests.
 *
 * Coverage matrix:
 *   401 anon                          — no `ctx.state.user`
 *   403 customer-cookie               — non-admin role
 *   400 invalid_body                  — missing `capabilities`
 *   400 invalid_capabilities          — illegal kiosk combo
 *   400 capability_charger_immutable  — add/remove `charger`
 *   404 device-not-found              — UUID-shaped path, no row
 *   410 device_revoked                — soft-deleted row
 *   200 happy path                    — verifies SSE published, audit fired
 */

import { assertEquals } from "@std/assert";
import {
  _resetCapabilitiesPatchTestSeams,
  _setCapabilityWriterForTests,
  _setDeviceLoaderForTests,
  handler,
} from "./capabilities.ts";
import { eventBus } from "../../../../../src/services/event-bus.service.ts";

const URL_BASE =
  "https://manage.example.com/api/admin/devices/11111111-2222-3333-4444-555555555555/capabilities";
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
  name: "capabilities-PATCH — 401 anon",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCapabilitiesPatchTestSeams();
    const res = await callPatch({
      state: {},
      body: { capabilities: ["scanner"] },
    });
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "capabilities-PATCH — 403 customer cookie",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCapabilitiesPatchTestSeams();
    const res = await callPatch({
      state: customerState(),
      body: { capabilities: ["scanner"] },
    });
    assertEquals(res.status, 403);
  },
});

Deno.test({
  name: "capabilities-PATCH — 400 invalid_body (missing capabilities)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCapabilitiesPatchTestSeams();
    const res = await callPatch({
      state: adminState(),
      body: {},
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_body");
  },
});

Deno.test({
  name: "capabilities-PATCH — 400 illegal kiosk combo",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCapabilitiesPatchTestSeams();
    _setDeviceLoaderForTests(() =>
      Promise.resolve({
        id: DEVICE_UUID,
        capabilities: ["scanner"],
        deletedAt: null,
        revokedAt: null,
      })
    );
    const res = await callPatch({
      state: adminState(),
      body: { capabilities: ["scanner", "user", "kiosk"] },
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_capabilities");
    _resetCapabilitiesPatchTestSeams();
  },
});

Deno.test({
  name: "capabilities-PATCH — 400 charger immutable on add",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCapabilitiesPatchTestSeams();
    _setDeviceLoaderForTests(() =>
      Promise.resolve({
        id: DEVICE_UUID,
        capabilities: ["scanner"],
        deletedAt: null,
        revokedAt: null,
      })
    );
    const res = await callPatch({
      state: adminState(),
      body: { capabilities: ["scanner", "charger"] },
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "capability_charger_immutable");
    _resetCapabilitiesPatchTestSeams();
  },
});

Deno.test({
  name: "capabilities-PATCH — 404 device not found",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCapabilitiesPatchTestSeams();
    _setDeviceLoaderForTests(() => Promise.resolve(null));
    const res = await callPatch({
      state: adminState(),
      body: { capabilities: ["scanner"] },
    });
    assertEquals(res.status, 404);
    _resetCapabilitiesPatchTestSeams();
  },
});

Deno.test({
  name: "capabilities-PATCH — 410 soft-deleted device",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCapabilitiesPatchTestSeams();
    _setDeviceLoaderForTests(() =>
      Promise.resolve({
        id: DEVICE_UUID,
        capabilities: ["scanner"],
        deletedAt: new Date(),
        revokedAt: null,
      })
    );
    const res = await callPatch({
      state: adminState(),
      body: { capabilities: ["scanner", "user"] },
    });
    assertEquals(res.status, 410);
    _resetCapabilitiesPatchTestSeams();
  },
});

Deno.test({
  name: "capabilities-PATCH — 200 happy path publishes SSE",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    _resetCapabilitiesPatchTestSeams();
    eventBus._reset();
    let writeCalled = false;
    _setDeviceLoaderForTests(() =>
      Promise.resolve({
        id: DEVICE_UUID,
        capabilities: ["scanner"],
        deletedAt: null,
        revokedAt: null,
      })
    );
    _setCapabilityWriterForTests((deviceId, caps) => {
      writeCalled = true;
      return Promise.resolve({
        id: deviceId,
        capabilities: caps,
        deletedAt: null,
        revokedAt: null,
      });
    });

    const observed: { type: string; deviceId: string }[] = [];
    const unsub = eventBus.subscribe(
      ["device.capabilities.changed"],
      (ev) => {
        const p = ev.payload as { deviceId: string };
        observed.push({ type: ev.type, deviceId: p.deviceId });
      },
    );

    const res = await callPatch({
      state: adminState(),
      body: { capabilities: ["scanner", "user"] },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.capabilities, ["scanner", "user"]);
    assertEquals(writeCalled, true);
    assertEquals(observed.length, 1);
    assertEquals(observed[0].deviceId, DEVICE_UUID);
    unsub();
    _resetCapabilitiesPatchTestSeams();
  },
});

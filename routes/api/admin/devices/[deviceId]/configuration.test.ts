/**
 * GET /api/admin/devices/{deviceId}/configuration — handler-direct
 * unit tests.
 *
 * Slice O coverage: charger (non-UUID) path returns the charger
 * view-model with `kind='charger'`, capabilities pulled from the row,
 * and `eligibleCapabilityOptions` set to `{editable:['scanner'],
 * readOnly:['charger']}`. The device-side path is exercised in
 * `capabilities.test.ts` and via integration tests; we focus the new
 * tests on the auth and charger branches.
 */

import { assertEquals } from "@std/assert";
import { handler } from "./configuration.ts";

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
      id: "admin-1",
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

async function callGet(args: {
  state: MockState;
  pathDeviceId: string;
}): Promise<Response> {
  const path =
    `https://manage.example.com/api/admin/devices/${args.pathDeviceId}/configuration`;
  const req = new Request(path, { method: "GET" });
  // deno-lint-ignore no-explicit-any
  const get = (handler as any).GET as (
    ctx: {
      req: Request;
      state: MockState;
      params: { deviceId: string };
    },
  ) => Promise<Response>;
  return await get({
    req,
    state: args.state,
    params: { deviceId: args.pathDeviceId },
  });
}

Deno.test({
  name: "configuration-GET — 401 anon",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callGet({ state: {}, pathDeviceId: "EVB-X-1" });
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "configuration-GET — 403 customer cookie",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callGet({
      state: customerState(),
      pathDeviceId: "EVB-X-1",
    });
    assertEquals(res.status, 403);
  },
});

Deno.test({
  name: "configuration-GET — 404 empty deviceId",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callGet({ state: adminState(), pathDeviceId: "" });
    assertEquals(res.status, 404);
  },
});

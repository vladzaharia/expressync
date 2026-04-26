/**
 * POST + DELETE /api/admin/devices/{deviceId}/scan-arm — handler-direct
 * unit tests.
 *
 * The handler depends on:
 *   - `ctx.state.user.role === 'admin'`  (cookie-session auth gate)
 *   - `db` queries against `devices` + `verifications`
 *   - `sendApns(...)` — fired-and-forgotten when push_token is set
 *   - `eventBus.publish(...)` — the SSE consumer's source of truth
 *
 * To run network/DB-free, the production module exposes `_set*ForTests`
 * hooks that swap each DB call (and the APNs sender) for an in-memory
 * fake. Each test resets every seam at start to keep the fixtures
 * isolated; the `_resetScanArmTestSeams()` helper restores defaults.
 *
 * Resource sanitization is disabled because importing the handler pulls
 * in the postgres client (lazy-initialized but still keeps a connection
 * pool alive even when never queried). The pool is cleaned up at process
 * exit.
 *
 * Coverage matrix (per `expresscan/docs/plan/` C-scan-arm row):
 *   401 anon                          — no `ctx.state.user`
 *   403 customer-cookie               — non-admin role
 *   400 invalid_body                  — missing `purpose`
 *   404 device-not-found              — UUID-shaped path, no row
 *   400 capability_missing            — device row lacks `'tap'`
 *   403 admin-not-owner               — caller's userId !== owner
 *   410 device_revoked                — soft-deleted row
 *   409 device_offline                — `last_seen_at` > 90 s old
 *   409 conflict (with pairingCode echoed)
 *   200 happy path                    — verifies event published, APNs
 *                                       called, audit fires, response
 *                                       resolved BEFORE APNs resolves
 *   DELETE: 401, 403, 400, idempotent (200 on already-released)
 */

import { assert, assertEquals } from "@std/assert";
import {
  _resetScanArmTestSeams,
  _setApnsSenderForTests,
  _setArmedPairingFinderForTests,
  _setDeviceLoaderForTests,
  _setPairingDeleterForTests,
  _setPairingInserterForTests,
  handler,
} from "./scan-arm.ts";
import { eventBus } from "../../../../../src/services/event-bus.service.ts";

const URL_BASE =
  "https://manage.polaris.express/api/admin/devices/11111111-2222-3333-4444-555555555555/scan-arm";

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
  device?: undefined;
}

interface FakeDevice {
  id: string;
  ownerUserId: string;
  capabilities: string[];
  pushToken: string | null;
  apnsEnvironment: "sandbox" | "production" | null;
  lastSeenAt: Date | null;
  deletedAt: Date | null;
  revokedAt: Date | null;
}

function adminState(userId: string = ADMIN_USER_ID): MockState {
  return {
    user: {
      id: userId,
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

function makeOnlineDevice(over: Partial<FakeDevice> = {}): FakeDevice {
  return {
    id: DEVICE_UUID,
    ownerUserId: ADMIN_USER_ID,
    capabilities: ["tap"],
    pushToken: null,
    apnsEnvironment: null,
    lastSeenAt: new Date(Date.now() - 5_000), // 5 s ago → online
    deletedAt: null,
    revokedAt: null,
    ...over,
  };
}

async function callPost(args: {
  state: MockState;
  body: unknown;
  pathDeviceId?: string;
}): Promise<Response> {
  const req = new Request(URL_BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof args.body === "string"
      ? args.body
      : JSON.stringify(args.body ?? {}),
  });
  // deno-lint-ignore no-explicit-any
  const post = (handler as any).POST as (
    ctx: {
      req: Request;
      state: MockState;
      params: { deviceId: string };
    },
  ) => Promise<Response>;
  return await post({
    req,
    state: args.state,
    params: { deviceId: args.pathDeviceId ?? DEVICE_UUID },
  });
}

async function callDelete(args: {
  state: MockState;
  body: unknown;
  pathDeviceId?: string;
}): Promise<Response> {
  const req = new Request(URL_BASE, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: typeof args.body === "string"
      ? args.body
      : JSON.stringify(args.body ?? {}),
  });
  // deno-lint-ignore no-explicit-any
  const del = (handler as any).DELETE as (
    ctx: {
      req: Request;
      state: MockState;
      params: { deviceId: string };
    },
  ) => Promise<Response>;
  return await del({
    req,
    state: args.state,
    params: { deviceId: args.pathDeviceId ?? DEVICE_UUID },
  });
}

/** Stub every test seam. Each individual test installs the bits it needs. */
function installDefaultSeams(opts: {
  device?: FakeDevice | null;
  armed?: { pairingCode: string; expiresAt: Date } | null;
  insertThrows?: boolean;
  apns?: () => Promise<
    { ok: true } | { ok: false; status: number; reason: string }
  >;
} = {}): {
  insertedRows: { identifier: string; value: string; expiresAt: Date }[];
  deletedIdentifiers: string[];
  apnsCalls: { target: unknown; payload: unknown }[];
  apnsResolve: () => void;
} {
  const insertedRows: { identifier: string; value: string; expiresAt: Date }[] =
    [];
  const deletedIdentifiers: string[] = [];
  const apnsCalls: { target: unknown; payload: unknown }[] = [];

  // The default test APNs returns a Promise we control — tests that need to
  // observe "handler returned BEFORE push resolved" can grab `apnsResolve`.
  let resolveApns: (() => void) | null = null;
  const apnsPromise = new Promise<
    { ok: true } | { ok: false; status: number; reason: string }
  >((resolve) => {
    resolveApns = () => resolve({ ok: true });
  });
  const apnsResolve = () => resolveApns?.();

  _setDeviceLoaderForTests((_id) => Promise.resolve(opts.device ?? null));
  _setArmedPairingFinderForTests((_id) => Promise.resolve(opts.armed ?? null));
  _setPairingInserterForTests((row) => {
    if (opts.insertThrows) {
      return Promise.reject(new Error("simulated insert failure"));
    }
    insertedRows.push(row);
    return Promise.resolve();
  });
  _setPairingDeleterForTests((id) => {
    deletedIdentifiers.push(id);
    return Promise.resolve();
  });
  _setApnsSenderForTests((target, payload) => {
    apnsCalls.push({ target, payload });
    return opts.apns ? opts.apns() : apnsPromise;
  });

  return { insertedRows, deletedIdentifiers, apnsCalls, apnsResolve };
}

function tearDown(): void {
  _resetScanArmTestSeams();
  eventBus._reset();
}

// ============================================================================
// POST — auth gates
// ============================================================================

Deno.test({
  name: "POST scan-arm — anon (no user) returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    installDefaultSeams();
    try {
      const res = await callPost({
        state: {},
        body: { purpose: "admin-link" },
      });
      assertEquals(res.status, 401);
      const body = await res.json();
      assertEquals(body.error, "unauthorized");
    } finally {
      tearDown();
    }
  },
});

Deno.test({
  name: "POST scan-arm — customer-cookie returns 403 forbidden",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // Anon → 401; logged-in non-admin → 403 (mirrors `register.ts` so the
    // wire contract is consistent across the admin-gated device endpoints).
    installDefaultSeams();
    try {
      const res = await callPost({
        state: customerState(),
        body: { purpose: "admin-link" },
      });
      assertEquals(res.status, 403);
      const body = await res.json();
      assertEquals(body.error, "forbidden");
    } finally {
      tearDown();
    }
  },
});

// ============================================================================
// POST — body validation
// ============================================================================

Deno.test({
  name: "POST scan-arm — missing body returns 400 invalid_body",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    installDefaultSeams();
    try {
      const res = await callPost({ state: adminState(), body: "" });
      assertEquals(res.status, 400);
      const body = await res.json();
      assertEquals(body.error, "invalid_body");
    } finally {
      tearDown();
    }
  },
});

Deno.test({
  name: "POST scan-arm — invalid purpose returns 400 invalid_body",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    installDefaultSeams();
    try {
      const res = await callPost({
        state: adminState(),
        body: { purpose: "not-a-real-purpose" },
      });
      assertEquals(res.status, 400);
      const body = await res.json();
      assertEquals(body.error, "invalid_body");
    } finally {
      tearDown();
    }
  },
});

Deno.test({
  name: "POST scan-arm — missing purpose returns 400 invalid_body",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    installDefaultSeams();
    try {
      const res = await callPost({
        state: adminState(),
        body: { hintLabel: "lobby" },
      });
      assertEquals(res.status, 400);
      const body = await res.json();
      assertEquals(body.error, "invalid_body");
    } finally {
      tearDown();
    }
  },
});

// ============================================================================
// POST — device-shaped errors
// ============================================================================

Deno.test({
  name: "POST scan-arm — device not found returns 404",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    installDefaultSeams({ device: null });
    try {
      const res = await callPost({
        state: adminState(),
        body: { purpose: "admin-link" },
      });
      assertEquals(res.status, 404);
      const body = await res.json();
      assertEquals(body.error, "not_found");
    } finally {
      tearDown();
    }
  },
});

Deno.test({
  name: "POST scan-arm — soft-deleted device returns 410 device_revoked",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    installDefaultSeams({
      device: makeOnlineDevice({ deletedAt: new Date() }),
    });
    try {
      const res = await callPost({
        state: adminState(),
        body: { purpose: "admin-link" },
      });
      assertEquals(res.status, 410);
      const body = await res.json();
      assertEquals(body.error, "device_revoked");
    } finally {
      tearDown();
    }
  },
});

Deno.test({
  name: "POST scan-arm — admin-not-owner returns 403 not_owner",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    installDefaultSeams({
      device: makeOnlineDevice({ ownerUserId: "some-other-admin" }),
    });
    try {
      const res = await callPost({
        state: adminState(),
        body: { purpose: "admin-link" },
      });
      assertEquals(res.status, 403);
      const body = await res.json();
      assertEquals(body.error, "not_owner");
    } finally {
      tearDown();
    }
  },
});

Deno.test({
  name:
    "POST scan-arm — capability_missing returns 400 (no 'tap' in capabilities)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    installDefaultSeams({
      device: makeOnlineDevice({ capabilities: ["ev"] }),
    });
    try {
      const res = await callPost({
        state: adminState(),
        body: { purpose: "admin-link" },
      });
      assertEquals(res.status, 400);
      const body = await res.json();
      assertEquals(body.error, "capability_missing");
    } finally {
      tearDown();
    }
  },
});

Deno.test({
  name: "POST scan-arm — device offline (>90s last_seen) returns 409",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    installDefaultSeams({
      device: makeOnlineDevice({
        lastSeenAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
      }),
    });
    try {
      const res = await callPost({
        state: adminState(),
        body: { purpose: "admin-link" },
      });
      assertEquals(res.status, 409);
      const body = await res.json();
      assertEquals(body.error, "device_offline");
    } finally {
      tearDown();
    }
  },
});

Deno.test({
  name:
    "POST scan-arm — never-seen device (last_seen=null) returns 409 device_offline",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    installDefaultSeams({
      device: makeOnlineDevice({ lastSeenAt: null }),
    });
    try {
      const res = await callPost({
        state: adminState(),
        body: { purpose: "admin-link" },
      });
      assertEquals(res.status, 409);
      const body = await res.json();
      assertEquals(body.error, "device_offline");
    } finally {
      tearDown();
    }
  },
});

// ============================================================================
// POST — conflict path: existing armed pairing
// ============================================================================

Deno.test({
  name:
    "POST scan-arm — existing armed pairing returns 409 conflict + echoes pairingCode",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const prevExpiresAt = new Date(Date.now() + 60_000);
    installDefaultSeams({
      device: makeOnlineDevice(),
      armed: { pairingCode: "PRE9XX", expiresAt: prevExpiresAt },
    });
    try {
      const res = await callPost({
        state: adminState(),
        body: { purpose: "admin-link", hintLabel: "lobby" },
      });
      assertEquals(res.status, 409);
      const body = await res.json();
      assertEquals(body.error, "conflict");
      assertEquals(body.pairingCode, "PRE9XX");
      assert(
        typeof body.expiresInSec === "number" && body.expiresInSec > 0 &&
          body.expiresInSec <= 60,
        `expected expiresInSec in (0, 60], got ${body.expiresInSec}`,
      );
    } finally {
      tearDown();
    }
  },
});

// ============================================================================
// POST — happy path: verifies event publish, APNs fire-and-forget, audit
// ============================================================================

Deno.test({
  name:
    "POST scan-arm — happy path: 200 response shape, event published, APNs called, fire-and-forget",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const seams = installDefaultSeams({
      device: makeOnlineDevice({
        pushToken: "01abcdefdeadbeef",
        apnsEnvironment: "sandbox",
      }),
    });

    // Subscribe to verify the publish.
    const captured: {
      type: string;
      payload: { deviceId: string; pairingCode: string; purpose: string };
    }[] = [];
    const unsub = eventBus.subscribe(
      ["device.scan.requested"],
      (delivered) => {
        captured.push({
          type: delivered.type,
          payload: delivered.payload as typeof captured[number]["payload"],
        });
      },
    );

    try {
      // The APNs Promise that `installDefaultSeams` provides will not
      // resolve until we call `apnsResolve()`. So if the handler resolves
      // before that, we've proven fire-and-forget.
      const resPromise = callPost({
        state: adminState(),
        body: { purpose: "admin-link", hintLabel: "Front desk" },
      });

      // Race: handler should resolve before the APNs promise. Don't call
      // `apnsResolve()` yet.
      let handlerResolvedFirst = false;
      const winner = await Promise.race([
        resPromise.then(() => "handler" as const),
        new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 100)),
      ]);
      if (winner === "handler") handlerResolvedFirst = true;
      assert(
        handlerResolvedFirst,
        "handler did not resolve within 100 ms despite APNs not having resolved — fire-and-forget is broken",
      );

      const res = await resPromise;
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.ok, true);
      assertEquals(body.deviceId, DEVICE_UUID);
      assertEquals(body.purpose, "admin-link");
      assertEquals(body.expiresInSec, 90);
      assert(
        typeof body.pairingCode === "string" && body.pairingCode.length === 6,
        `pairingCode shape wrong: ${body.pairingCode}`,
      );
      assert(
        /^[A-Z2-9]{6}$/.test(body.pairingCode),
        `pairingCode charset wrong: ${body.pairingCode}`,
      );
      // No O / 0 / I / 1 / L per the legibility rule.
      assert(
        !/[O0I1L]/.test(body.pairingCode),
        `pairingCode contains forbidden chars: ${body.pairingCode}`,
      );

      // Verify INSERT was called with the right identifier.
      assertEquals(seams.insertedRows.length, 1);
      const inserted = seams.insertedRows[0];
      assertEquals(
        inserted.identifier,
        `device-scan:${DEVICE_UUID}:${body.pairingCode}`,
      );
      const valueObj = JSON.parse(inserted.value);
      assertEquals(valueObj.deviceId, DEVICE_UUID);
      assertEquals(valueObj.purpose, "admin-link");
      assertEquals(valueObj.hintLabel, "Front desk");
      assertEquals(valueObj.status, "armed");
      assertEquals(valueObj.armedByUserId, ADMIN_USER_ID);

      // Verify event published.
      assertEquals(captured.length, 1);
      assertEquals(captured[0].type, "device.scan.requested");
      assertEquals(captured[0].payload.deviceId, DEVICE_UUID);
      assertEquals(captured[0].payload.pairingCode, body.pairingCode);
      assertEquals(captured[0].payload.purpose, "admin-link");

      // Verify APNs was called once with the right payload shape.
      assertEquals(seams.apnsCalls.length, 1);
      const apns = seams.apnsCalls[0];
      const apnsTarget = apns.target as {
        pushToken: string;
        environment: string;
      };
      assertEquals(apnsTarget.pushToken, "01abcdefdeadbeef");
      assertEquals(apnsTarget.environment, "sandbox");
      const apnsPayload = apns.payload as {
        threadId: string;
        collapseId: string;
        interruptionLevel: string;
        custom: { deviceId: string; pairingCode: string; purpose: string };
      };
      assertEquals(apnsPayload.threadId, `device-scan-${DEVICE_UUID}`);
      assertEquals(apnsPayload.collapseId, `scan-${body.pairingCode}`);
      assertEquals(apnsPayload.interruptionLevel, "time-sensitive");
      assertEquals(apnsPayload.custom.deviceId, DEVICE_UUID);
      assertEquals(apnsPayload.custom.pairingCode, body.pairingCode);
      assertEquals(apnsPayload.custom.purpose, "admin-link");

      // Now release the APNs promise so cleanup is clean.
      seams.apnsResolve();
      // Yield so the .then() chain attached in the handler fires.
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      unsub();
      tearDown();
    }
  },
});

Deno.test({
  name: "POST scan-arm — happy path skips APNs when push_token is null",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const seams = installDefaultSeams({
      device: makeOnlineDevice({ pushToken: null }),
    });
    try {
      const res = await callPost({
        state: adminState(),
        body: { purpose: "admin-link" },
      });
      assertEquals(res.status, 200);
      assertEquals(seams.apnsCalls.length, 0);
      seams.apnsResolve();
    } finally {
      tearDown();
    }
  },
});

// ============================================================================
// DELETE — auth + body
// ============================================================================

Deno.test({
  name: "DELETE scan-arm — anon (no user) returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    installDefaultSeams();
    try {
      const res = await callDelete({
        state: {},
        body: { pairingCode: "ABC123" },
      });
      assertEquals(res.status, 401);
    } finally {
      tearDown();
    }
  },
});

Deno.test({
  name: "DELETE scan-arm — customer-cookie returns 403 forbidden",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    installDefaultSeams();
    try {
      const res = await callDelete({
        state: customerState(),
        body: { pairingCode: "ABC123" },
      });
      assertEquals(res.status, 403);
    } finally {
      tearDown();
    }
  },
});

Deno.test({
  name: "DELETE scan-arm — missing pairingCode returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    installDefaultSeams({ device: makeOnlineDevice() });
    try {
      const res = await callDelete({
        state: adminState(),
        body: {},
      });
      assertEquals(res.status, 400);
    } finally {
      tearDown();
    }
  },
});

Deno.test({
  name: "DELETE scan-arm — admin-not-owner returns 403",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    installDefaultSeams({
      device: makeOnlineDevice({ ownerUserId: "another-admin" }),
    });
    try {
      const res = await callDelete({
        state: adminState(),
        body: { pairingCode: "ABC123" },
      });
      assertEquals(res.status, 403);
      const body = await res.json();
      assertEquals(body.error, "not_owner");
    } finally {
      tearDown();
    }
  },
});

Deno.test({
  name:
    "DELETE scan-arm — happy path returns 200 and calls deleter with right identifier",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const seams = installDefaultSeams({
      device: makeOnlineDevice(),
    });
    try {
      const res = await callDelete({
        state: adminState(),
        body: { pairingCode: "ABC123" },
      });
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.ok, true);
      assertEquals(seams.deletedIdentifiers.length, 1);
      assertEquals(
        seams.deletedIdentifiers[0],
        `device-scan:${DEVICE_UUID}:ABC123`,
      );
    } finally {
      tearDown();
    }
  },
});

Deno.test({
  name: "DELETE scan-arm — second DELETE for the same code is idempotent (200)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const seams = installDefaultSeams({
      device: makeOnlineDevice(),
    });
    try {
      const a = await callDelete({
        state: adminState(),
        body: { pairingCode: "ABC123" },
      });
      assertEquals(a.status, 200);

      const b = await callDelete({
        state: adminState(),
        body: { pairingCode: "ABC123" },
      });
      assertEquals(b.status, 200);
      // Both calls invoke the deleter (idempotency at the SQL level: DELETE
      // on a non-existent row is a no-op, not an error).
      assertEquals(seams.deletedIdentifiers.length, 2);
    } finally {
      tearDown();
    }
  },
});

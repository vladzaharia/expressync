/**
 * POST /api/devices/me/state/sync — handler-direct unit tests.
 *
 * Network-free coverage:
 *   - missing bearer → 401
 *   - rejects unknown body fields (strict zod)
 *   - rejects malformed JSON
 *   - rejects unknown setting key
 *   - rejects bad pushPermission enum
 *   - valid request proceeds past validation (DB throws → 500 without
 *     a live DB; locks in "past validation gate")
 *   - LWW + clamp covered in the unit tests of the helpers; this file
 *     covers the wire validation surface.
 */

import { assert, assertEquals } from "@std/assert";

const URL_SYNC = "https://manage.example.com/api/devices/me/state/sync";

interface MockState {
  device?: {
    id: string;
    ownerUserId: string;
    capabilities: string[];
    secret: string;
    tokenId: string;
  };
  user?: { id: string };
}

async function callSync(
  state: MockState,
  body: unknown,
  contentType = "application/json",
  headers: Record<string, string> = {},
): Promise<Response> {
  const { handler } = await import("./sync.ts");
  // deno-lint-ignore no-explicit-any
  const post = (handler as any).POST as (
    ctx: { req: Request; state: MockState; params: Record<string, string> },
  ) => Promise<Response>;
  const req = new Request(URL_SYNC, {
    method: "POST",
    headers: { "content-type": contentType, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body ?? {}),
  });
  return await post({ req, state, params: {} });
}

function deviceState(): MockState {
  return {
    device: {
      id: "11111111-2222-3333-4444-555555555555",
      ownerUserId: "admin-1",
      capabilities: ["scanner"],
      secret: "deadbeef".repeat(8),
      tokenId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    },
  };
}

function validBody() {
  return {
    pendingSettings: [],
    diagnostics: {
      appVersion: "2.0.0",
      osVersion: "iOS 26.0",
      model: "iPhone 17 Pro",
      pushPermission: "authorized" as const,
      nfcAvailable: true,
      pendingUploads: 0,
      reconnectCount: 0,
    },
  };
}

// ===========================================================================
// Auth
// ===========================================================================

Deno.test({
  name: "me/state/sync — missing device context returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callSync({}, validBody());
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error, "unauthorized");
  },
});

// ===========================================================================
// Body validation — strict shape, unknown fields rejected.
// ===========================================================================

Deno.test({
  name: "me/state/sync — malformed JSON returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callSync(deviceState(), "{not json");
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_body");
  },
});

Deno.test({
  name: "me/state/sync — unknown top-level field returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callSync(deviceState(), {
      ...validBody(),
      malicious: "value",
    });
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name: "me/state/sync — unknown diagnostics field returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const body = validBody();
    const res = await callSync(deviceState(), {
      ...body,
      diagnostics: { ...body.diagnostics, extraField: 1 },
    });
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name: "me/state/sync — bad pushPermission enum returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const body = validBody();
    const res = await callSync(deviceState(), {
      ...body,
      diagnostics: { ...body.diagnostics, pushPermission: "yes" },
    });
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name: "me/state/sync — unknown setting key returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const body = {
      ...validBody(),
      pendingSettings: [
        {
          key: "unknown.key",
          value: "x",
          clientUpdatedAt: new Date().toISOString(),
          updatedBy: "device:abc",
        },
      ],
    };
    const res = await callSync(deviceState(), body);
    assertEquals(res.status, 400);
    const j = await res.json();
    assertEquals(j.error, "invalid_body");
  },
});

Deno.test({
  name: "me/state/sync — invalid timestamp returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const body = {
      ...validBody(),
      pendingSettings: [
        {
          key: "device.label",
          value: "Phone",
          clientUpdatedAt: "not-a-date",
          updatedBy: "device:abc",
        },
      ],
    };
    const res = await callSync(deviceState(), body);
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name: "me/state/sync — wrong-typed setting value returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const body = {
      ...validBody(),
      pendingSettings: [
        {
          // notifications.scanRequest is a boolean, not a number
          key: "notifications.scanRequest",
          value: 42,
          clientUpdatedAt: new Date().toISOString(),
          updatedBy: "device:abc",
        },
      ],
    };
    const res = await callSync(deviceState(), body);
    assertEquals(res.status, 400);
  },
});

// ===========================================================================
// Past-validation path — without a live DB, the SELECT/UPDATE throws → 500.
// ===========================================================================

Deno.test({
  name: "me/state/sync — valid body proceeds past validation (DB-bound)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callSync(deviceState(), validBody());
    await res.body?.cancel();
    assert(
      res.status === 200 || res.status === 500 || res.status === 410,
      `unexpected status ${res.status}`,
    );
  },
});

Deno.test({
  name: "me/state/sync — valid body with one delta proceeds past validation",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const body = {
      ...validBody(),
      pendingSettings: [
        {
          key: "device.label",
          value: "My Phone",
          clientUpdatedAt: new Date().toISOString(),
          updatedBy: "device:abc",
        },
      ],
    };
    const res = await callSync(deviceState(), body);
    await res.body?.cancel();
    assert(
      res.status === 200 || res.status === 500 || res.status === 410,
      `unexpected status ${res.status}`,
    );
  },
});

// ===========================================================================
// Idempotency: when the cache is hit, the handler must short-circuit BEFORE
// any DB work. Without a live DB, a missing Idempotency-Key + valid bearer
// would 500 on the SELECT; a cache hit returns the cached body directly.
// We don't have an in-process cache to seed here, so the best we can do is
// assert the wrapper attempts the lookup (also DB-bound — same DB, same
// 500-or-200 outcome). The withIdempotency unit tests cover the cache logic.
// ===========================================================================

Deno.test({
  name: "me/state/sync — Idempotency-Key header is accepted",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callSync(deviceState(), validBody(), "application/json", {
      "Idempotency-Key": "test-key-1",
    });
    await res.body?.cancel();
    // 200 (DB available) | 500 (no DB) | 410 (soft-deleted). Never 400/401.
    assert(
      res.status === 200 || res.status === 500 || res.status === 410,
      `unexpected status ${res.status}`,
    );
  },
});

// ===========================================================================
// Future-stamp clamp — surface check on the helper. The clamp itself is
// covered by lww.test.ts; here we confirm a far-future timestamp doesn't
// trip body validation (the clamp runs on the post-validation path).
// ===========================================================================

Deno.test({
  name: "me/state/sync — far-future timestamp passes validation (clamp later)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const body = {
      ...validBody(),
      pendingSettings: [
        {
          key: "device.label",
          value: "Phone",
          // 100 years in the future — must NOT 400; the clamp pulls it
          // back to now+5s during merge.
          clientUpdatedAt: new Date(Date.now() + 100 * 365 * 86400_000)
            .toISOString(),
          updatedBy: "device:abc",
        },
      ],
    };
    const res = await callSync(deviceState(), body);
    await res.body?.cancel();
    assert(
      res.status === 200 || res.status === 500 || res.status === 410,
      `unexpected status ${res.status}`,
    );
  },
});

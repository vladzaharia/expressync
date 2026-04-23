/**
 * Polaris Track F — customer endpoint regression tests.
 *
 * These tests focus on the high-value gates that don't require a live DB:
 *   - Authentication: 401 when `ctx.state.user` is missing.
 *   - Body validation: 400 on malformed input.
 *   - Capability denial: 403 with `CapabilityDeniedError.status === 403`
 *     when scope.isActive is false.
 *   - Ownership rejection: 404 with `OwnershipError.status === 404` when
 *     `ctx.state.customerScope` doesn't include the requested resource.
 *   - Read-only impersonation: 403 on POST/PUT/PATCH/DELETE when
 *     `ctx.state.actingAs` is set.
 *   - delete-account: 501 (deferred MVP).
 *
 * Full DB-touching paths (real `assertOwnership` lookups, Lago/StEvE
 * dispatch) are exercised by integration tests in the harness; here we
 * verify the handlers' intent in isolation.
 */

import { assertEquals } from "@std/assert";
import type { CustomerScope, State } from "@/utils.ts";

const HOST = "https://polaris.express";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface CallOpts {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  state?: Partial<State>;
  params?: Record<string, string>;
  url?: string;
}

interface MockCtx {
  req: Request;
  state: State;
  params: Record<string, string>;
}

function mockCtx(path: string, opts: CallOpts): MockCtx {
  const url = opts.url ?? `${HOST}${path}`;
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json" },
  };
  if (opts.body !== undefined) {
    init.body = typeof opts.body === "string"
      ? opts.body
      : JSON.stringify(opts.body);
  }
  return {
    req: new Request(url, init),
    state: opts.state ?? {},
    params: opts.params ?? {},
  };
}

// Default user/scope helpers. customerScope being preset on ctx.state means
// `resolveCustomerScope` returns the cached value without ever touching DB.
function userState(overrides?: Partial<State>): Partial<State> {
  return {
    user: {
      id: "user-self",
      name: "Self",
      email: "self@example.com",
      emailVerified: true,
      role: "customer",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    customerScope: {
      lagoCustomerExternalId: "cust_self",
      ocppTagPks: [10, 20],
      mappingIds: [100, 200],
      isActive: true,
    } satisfies CustomerScope,
    ...overrides,
  };
}

function inactiveScope(): Partial<State> {
  return userState({
    customerScope: {
      lagoCustomerExternalId: "cust_self",
      ocppTagPks: [10],
      mappingIds: [100],
      isActive: false,
    },
  });
}

function emptyScope(): Partial<State> {
  return userState({
    customerScope: {
      lagoCustomerExternalId: null,
      ocppTagPks: [],
      mappingIds: [],
      isActive: false,
    },
  });
}

function impersonatingAdmin(): Partial<State> {
  return {
    user: {
      id: "admin-1",
      name: "Admin",
      email: "admin@example.com",
      emailVerified: true,
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    actingAs: "user-self",
    customerScope: {
      lagoCustomerExternalId: "cust_self",
      ocppTagPks: [10],
      mappingIds: [100],
      isActive: true,
    },
  };
}

async function call(
  modulePath: string,
  ctx: MockCtx,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
): Promise<Response> {
  const mod = await import(modulePath);
  // deno-lint-ignore no-explicit-any
  const handler = (mod.handler as any)[method] as (
    c: MockCtx,
  ) => Promise<Response>;
  if (typeof handler !== "function") {
    throw new Error(`No ${method} handler in ${modulePath}`);
  }
  return await handler(ctx);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

Deno.test({
  name: "GET /api/customer/sessions — 401 when unauthenticated",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/sessions", {});
    const res = await call("./sessions/index.ts", ctx, "GET");
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "GET /api/customer/sessions — empty scope returns 200 + empty page",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/sessions", { state: emptyScope() });
    const res = await call("./sessions/index.ts", ctx, "GET");
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.items, []);
    assertEquals(body.total, 0);
  },
});

Deno.test({
  name: "GET /api/customer/sessions — invalid skip → 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/sessions?skip=-1", {
      state: userState(),
    });
    const res = await call("./sessions/index.ts", ctx, "GET");
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name: "GET /api/customer/sessions — invalid limit (too high) → 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/sessions?limit=500", {
      state: userState(),
    });
    const res = await call("./sessions/index.ts", ctx, "GET");
    assertEquals(res.status, 400);
  },
});

// ---------------------------------------------------------------------------
// Reservations — POST capability + ownership gates
// ---------------------------------------------------------------------------

Deno.test({
  name: "POST /api/customer/reservations — 401 unauthenticated",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/reservations", {
      method: "POST",
      body: {},
    });
    const res = await call("./reservations/index.ts", ctx, "POST");
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name:
    "POST /api/customer/reservations — impersonating admin gets 403 (read-only)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/reservations", {
      method: "POST",
      body: {},
      state: impersonatingAdmin(),
    });
    const res = await call("./reservations/index.ts", ctx, "POST");
    assertEquals(res.status, 403);
  },
});

Deno.test({
  name: "POST /api/customer/reservations — invalid JSON body → 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/reservations", {
      method: "POST",
      body: "not-json",
      state: userState(),
    });
    const res = await call("./reservations/index.ts", ctx, "POST");
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name:
    "POST /api/customer/reservations — inactive scope → 403 (capability denied)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/reservations", {
      method: "POST",
      body: {
        chargeBoxId: "EVSE-1",
        connectorId: 1,
        steveOcppTagPk: 10,
        startAtIso: new Date(Date.now() + 60_000).toISOString(),
        endAtIso: new Date(Date.now() + 3_600_000).toISOString(),
      },
      state: inactiveScope(),
    });
    const res = await call("./reservations/index.ts", ctx, "POST");
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.capability, "reserve");
  },
});

Deno.test({
  name:
    "POST /api/customer/reservations — non-owned tag → 404 (ownership denied)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // `steveOcppTagPk: 999` is not in scope.ocppTagPks so assertOwnership
    // throws OwnershipError before any DB access.
    const ctx = mockCtx("/api/customer/reservations", {
      method: "POST",
      body: {
        chargeBoxId: "EVSE-1",
        connectorId: 1,
        steveOcppTagPk: 999,
        startAtIso: new Date(Date.now() + 60_000).toISOString(),
        endAtIso: new Date(Date.now() + 3_600_000).toISOString(),
      },
      state: userState(),
    });
    const res = await call("./reservations/index.ts", ctx, "POST");
    assertEquals(res.status, 404);
  },
});

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

Deno.test({
  name: "GET /api/customer/cards — 401 unauthenticated",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/cards", {});
    const res = await call("./cards/index.ts", ctx, "GET");
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "GET /api/customer/cards — empty scope returns empty cards array",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/cards", { state: emptyScope() });
    const res = await call("./cards/index.ts", ctx, "GET");
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.cards, []);
  },
});

Deno.test({
  name: "GET /api/customer/cards/[id] — non-owned id → 404",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/cards/999", {
      state: userState(),
      params: { id: "999" },
    });
    const res = await call("./cards/[id].ts", ctx, "GET");
    assertEquals(res.status, 404);
  },
});

Deno.test({
  name: "GET /api/customer/cards/[id] — invalid id → 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/cards/abc", {
      state: userState(),
      params: { id: "abc" },
    });
    const res = await call("./cards/[id].ts", ctx, "GET");
    assertEquals(res.status, 400);
  },
});

// ---------------------------------------------------------------------------
// Scan-start (POST) — capability + ownership gates
// ---------------------------------------------------------------------------

Deno.test({
  name: "POST /api/customer/scan-start — 401 unauthenticated",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/scan-start", {
      method: "POST",
      body: {},
    });
    const res = await call("./scan-start.ts", ctx, "POST");
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "POST /api/customer/scan-start — impersonating admin → 403",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/scan-start", {
      method: "POST",
      body: {},
      state: impersonatingAdmin(),
    });
    const res = await call("./scan-start.ts", ctx, "POST");
    assertEquals(res.status, 403);
  },
});

Deno.test({
  name: "POST /api/customer/scan-start — missing chargeBoxId → 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/scan-start", {
      method: "POST",
      body: { ocppTagPk: 10 },
      state: userState(),
    });
    const res = await call("./scan-start.ts", ctx, "POST");
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name:
    "POST /api/customer/scan-start — inactive scope → 403 (start_charge denied)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/scan-start", {
      method: "POST",
      body: { chargeBoxId: "EVSE-1", connectorId: 1, ocppTagPk: 10 },
      state: inactiveScope(),
    });
    const res = await call("./scan-start.ts", ctx, "POST");
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.capability, "start_charge");
  },
});

Deno.test({
  name: "POST /api/customer/scan-start — non-owned tag pk → 404",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/scan-start", {
      method: "POST",
      body: { chargeBoxId: "EVSE-1", connectorId: 1, ocppTagPk: 999 },
      state: userState(),
    });
    const res = await call("./scan-start.ts", ctx, "POST");
    assertEquals(res.status, 404);
  },
});

// ---------------------------------------------------------------------------
// Session-stop (POST)
// ---------------------------------------------------------------------------

Deno.test({
  name: "POST /api/customer/session-stop — 401 unauthenticated",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/session-stop", {
      method: "POST",
      body: {},
    });
    const res = await call("./session-stop.ts", ctx, "POST");
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "POST /api/customer/session-stop — inactive scope → 403",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/session-stop", {
      method: "POST",
      body: { transactionId: 1, chargeBoxId: "EVSE-1" },
      state: inactiveScope(),
    });
    const res = await call("./session-stop.ts", ctx, "POST");
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.capability, "stop_charge");
  },
});

Deno.test({
  name: "POST /api/customer/session-stop — invalid body shape → 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/session-stop", {
      method: "POST",
      body: { transactionId: "abc" },
      state: userState(),
    });
    const res = await call("./session-stop.ts", ctx, "POST");
    assertEquals(res.status, 400);
  },
});

// ---------------------------------------------------------------------------
// Onboarded
// ---------------------------------------------------------------------------

Deno.test({
  name: "POST /api/customer/onboarded — 401 unauthenticated",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/onboarded", { method: "POST" });
    const res = await call("./onboarded.ts", ctx, "POST");
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "POST /api/customer/onboarded — impersonating admin → 403",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/onboarded", {
      method: "POST",
      state: impersonatingAdmin(),
    });
    const res = await call("./onboarded.ts", ctx, "POST");
    assertEquals(res.status, 403);
  },
});

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

Deno.test({
  name: "PUT /api/customer/profile — email change → 403",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/profile", {
      method: "PUT",
      body: { email: "new@example.com" },
      state: userState(),
    });
    const res = await call("./profile.ts", ctx, "PUT");
    assertEquals(res.status, 403);
  },
});

Deno.test({
  name: "PUT /api/customer/profile — impersonating admin → 403",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/profile", {
      method: "PUT",
      body: { name: "X" },
      state: impersonatingAdmin(),
    });
    const res = await call("./profile.ts", ctx, "PUT");
    assertEquals(res.status, 403);
  },
});

Deno.test({
  name: "PUT /api/customer/profile — overlong name (>200) → 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/profile", {
      method: "PUT",
      body: { name: "x".repeat(300) },
      state: userState(),
    });
    const res = await call("./profile.ts", ctx, "PUT");
    assertEquals(res.status, 400);
  },
});

// ---------------------------------------------------------------------------
// delete-account — deferred MVP returns 501
// ---------------------------------------------------------------------------

Deno.test({
  name: "POST /api/customer/delete-account — 501 (deferred)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/delete-account", {
      method: "POST",
      state: userState(),
    });
    const res = await call("./delete-account.ts", ctx, "POST");
    assertEquals(res.status, 501);
  },
});

Deno.test({
  name: "POST /api/customer/delete-account — 401 unauthenticated",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/delete-account", { method: "POST" });
    const res = await call("./delete-account.ts", ctx, "POST");
    assertEquals(res.status, 401);
  },
});

// ---------------------------------------------------------------------------
// Impersonation start — admin role required
// ---------------------------------------------------------------------------

Deno.test({
  name: "POST /api/customer/impersonation/start — non-admin → 403",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/impersonation/start", {
      method: "POST",
      body: { customerUserId: "u1" },
      state: userState(), // role=customer
    });
    const res = await call("./impersonation/start.ts", ctx, "POST");
    assertEquals(res.status, 403);
  },
});

Deno.test({
  name: "POST /api/customer/impersonation/start — impersonate self → 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const adminState: Partial<State> = {
      user: {
        id: "admin-1",
        name: "Admin",
        email: "admin@example.com",
        emailVerified: true,
        role: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
    const ctx = mockCtx("/api/customer/impersonation/start", {
      method: "POST",
      body: { customerUserId: "admin-1" },
      state: adminState,
    });
    const res = await call("./impersonation/start.ts", ctx, "POST");
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name: "POST /api/customer/impersonation/start — already impersonating → 409",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/impersonation/start", {
      method: "POST",
      body: { customerUserId: "u2" },
      state: impersonatingAdmin(),
    });
    const res = await call("./impersonation/start.ts", ctx, "POST");
    assertEquals(res.status, 409);
  },
});

Deno.test({
  name: "POST /api/customer/impersonation/end — non-admin → 403",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/impersonation/end", {
      method: "POST",
      state: userState(),
    });
    const res = await call("./impersonation/end.ts", ctx, "POST");
    assertEquals(res.status, 403);
  },
});

// ---------------------------------------------------------------------------
// Notifications endpoints — 401 path is the only one we can run without DB.
// ---------------------------------------------------------------------------

Deno.test({
  name: "GET /api/customer/notifications/unread-count — 401 unauthenticated",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/notifications/unread-count", {});
    const res = await call("./notifications/unread-count.ts", ctx, "GET");
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "GET /api/customer/notifications/unread — 401 unauthenticated",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/notifications/unread", {});
    const res = await call("./notifications/unread.ts", ctx, "GET");
    assertEquals(res.status, 401);
  },
});

// ---------------------------------------------------------------------------
// Subscription / usage / invoices — 401 path
// ---------------------------------------------------------------------------

Deno.test({
  name: "GET /api/customer/subscription — 401 unauthenticated",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/subscription", {});
    const res = await call("./subscription.ts", ctx, "GET");
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "GET /api/customer/subscription — empty scope returns null",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/subscription", {
      state: emptyScope(),
    });
    const res = await call("./subscription.ts", ctx, "GET");
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.subscription, null);
  },
});

Deno.test({
  name: "GET /api/customer/usage — invalid period → 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/usage?period=lol", {
      state: userState(),
    });
    const res = await call("./usage.ts", ctx, "GET");
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name: "GET /api/customer/usage — empty scope returns null usage",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/usage", { state: emptyScope() });
    const res = await call("./usage.ts", ctx, "GET");
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.usage, null);
  },
});

Deno.test({
  name: "GET /api/customer/invoices — empty scope returns empty page",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/invoices", { state: emptyScope() });
    const res = await call("./invoices/index.ts", ctx, "GET");
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.invoices, []);
    assertEquals(body.totalUnpaidCents, 0);
  },
});

Deno.test({
  name: "GET /api/customer/invoices/[id] — empty scope → 404",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = mockCtx("/api/customer/invoices/inv_x", {
      state: emptyScope(),
      params: { id: "inv_x" },
    });
    const res = await call("./invoices/[id]/index.ts", ctx, "GET");
    assertEquals(res.status, 404);
  },
});

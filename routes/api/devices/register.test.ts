/**
 * POST /api/devices/register — handler-direct unit tests.
 *
 * No DB required for the early-rejection paths:
 *   - missing cookie session → 401
 *   - non-admin role → 403
 *   - malformed JSON → 400 invalid_body
 *   - body missing fields → 400 (mapped via zodReason)
 *   - bad platform → 400 invalid_platform
 *   - bad capability → 400 invalid_capabilities
 *   - bad codeVerifier (too short) → 400 invalid_verifier
 *
 * The DB-bound paths (claim, insert) are exercised by an integration
 * harness in Wave 2's gate; here we focus on locking in the handler's
 * branch table and the security-critical response headers.
 *
 * `sanitizeResources` is disabled because the handler imports the
 * postgres pool which keeps connections alive even when no query runs.
 */

import { assert, assertEquals } from "@std/assert";

const URL_REGISTER = "https://manage.polaris.express/api/devices/register";

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

async function callRegister(
  state: MockState,
  body: unknown,
): Promise<Response> {
  const { handler } = await import("./register.ts");
  // deno-lint-ignore no-explicit-any
  const post = (handler as any).POST as (
    ctx: { req: Request; state: MockState; params: Record<string, string> },
  ) => Promise<Response>;
  const req = new Request(URL_REGISTER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body ?? {}),
  });
  return await post({ req, state, params: {} });
}

const VALID_VERIFIER = "a".repeat(64); // 64 chars satisfies the 43..256 floor.
const VALID_CHALLENGE_BODY_BASE = {
  oneTimeCode: "abcdef-fake-code",
  codeVerifier: VALID_VERIFIER,
  label: "Test iPhone",
  platform: "ios" as const,
  model: "iPhone 16 Pro",
  osVersion: "18.4.1",
  appVersion: "1.0.0",
  apnsEnvironment: "sandbox" as const,
  requestedCapabilities: ["tap"],
};

function adminState(): MockState {
  return {
    user: {
      id: "admin-user-1",
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

// ============================================================================
// Auth gating
// ============================================================================

Deno.test({
  name: "register — no cookie session returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callRegister({}, VALID_CHALLENGE_BODY_BASE);
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error, "unauthorized");
  },
});

Deno.test({
  name: "register — customer-role session returns 403",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callRegister(customerState(), VALID_CHALLENGE_BODY_BASE);
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.error, "forbidden");
  },
});

// ============================================================================
// Body validation — Zod-driven branches mapped to canonical 400 reasons.
// ============================================================================

Deno.test({
  name: "register — malformed JSON returns 400 invalid_body",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callRegister(adminState(), "{not-json");
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_body");
  },
});

Deno.test({
  name: "register — missing oneTimeCode returns 400 invalid_code",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { oneTimeCode: _drop, ...rest } = VALID_CHALLENGE_BODY_BASE;
    const res = await callRegister(adminState(), rest);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_code");
  },
});

Deno.test({
  name: "register — codeVerifier too short returns 400 invalid_verifier",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callRegister(adminState(), {
      ...VALID_CHALLENGE_BODY_BASE,
      codeVerifier: "tooshort",
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_verifier");
  },
});

Deno.test({
  name: "register — bad platform returns 400 invalid_platform",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callRegister(adminState(), {
      ...VALID_CHALLENGE_BODY_BASE,
      platform: "windows",
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_platform");
  },
});

Deno.test({
  name: "register — empty capabilities returns 400 invalid_capabilities",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callRegister(adminState(), {
      ...VALID_CHALLENGE_BODY_BASE,
      requestedCapabilities: [],
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_capabilities");
  },
});

Deno.test({
  name: "register — unknown capability returns 400 invalid_capabilities",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callRegister(adminState(), {
      ...VALID_CHALLENGE_BODY_BASE,
      requestedCapabilities: ["banana"],
    });
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_capabilities");
  },
});

// ============================================================================
// Response cache headers — non-negotiable per `60-security.md` §1.
// ============================================================================

Deno.test({
  name: "register — 401 response carries Cache-Control: no-store",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callRegister({}, VALID_CHALLENGE_BODY_BASE);
    assertEquals(res.headers.get("Cache-Control"), "no-store");
    assertEquals(res.headers.get("Pragma"), "no-cache");
  },
});

Deno.test({
  name: "register — 403 response carries Cache-Control: no-store",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callRegister(customerState(), VALID_CHALLENGE_BODY_BASE);
    assertEquals(res.headers.get("Cache-Control"), "no-store");
  },
});

// ============================================================================
// Latency-floor jitter — assert the 50ms floor is respected.
// ============================================================================

Deno.test({
  name: "register — observes the 50ms latency-floor on rejection paths",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const t0 = Date.now();
    await callRegister({}, VALID_CHALLENGE_BODY_BASE);
    const elapsed = Date.now() - t0;
    // The handler waits 50..150ms even for the 401 short-circuit; allow a
    // small margin for clock jitter.
    assert(
      elapsed >= 45,
      `expected at least ~50ms latency floor; got ${elapsed}ms`,
    );
  },
});

// ============================================================================
// PKCE replay — calling the claim path with a known-bad oneTimeCode ought
// to return 400 invalid_code (the lookup misses → null). Without a DB the
// claim helper short-circuits to null on lookup error — same response.
// ============================================================================

Deno.test({
  name:
    "register — admin session + body with non-existent oneTimeCode returns 400 invalid_code (replay/PKCE branch)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // With no live DB, the helper's lookup throws and `claimOneTimeCode`
    // returns null — handler maps to 400 invalid_code. This locks in the
    // contract that ANY claim failure (replay, mismatch, expired, missing,
    // DB outage) collapses to 400 invalid_code (anti-enumeration).
    const res = await callRegister(adminState(), VALID_CHALLENGE_BODY_BASE);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_code");
  },
});

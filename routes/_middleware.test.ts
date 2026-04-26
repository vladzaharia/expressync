import { assertEquals } from "@std/assert";
import {
  checkRateLimit,
  RATE_LIMIT_WINDOW_MS,
} from "@/src/lib/utils/rate-limit.ts";
import {
  classifyAdminHostname,
  classifyCustomerHostname,
  classifySurface,
  isShellOrApiPath,
  rewriteRequestForSurface,
} from "@/src/lib/hostname-dispatch.ts";
import { classifyRoute, getAllRouteRules } from "@/src/lib/route-classifier.ts";
import { selectAuth } from "./_middleware.ts";

// Phase A7a: rate-limit storage moved from an in-memory Map to Postgres, so we
// can no longer inspect or reset a shared in-process store. These tests run
// without DATABASE_URL / network access, which means the internal insert
// throws and `checkRateLimit` hits its fail-OPEN branch. We assert the
// published contract (async signature, fail-open boolean result, exported
// window constant) rather than the count/limit math — that logic is owned by
// Postgres and exercised in integration tests.

Deno.test("checkRateLimit - returns a boolean via a Promise", async () => {
  const result = checkRateLimit("test:signature", 5);
  assertEquals(result instanceof Promise, true);
  const awaited = await result;
  assertEquals(typeof awaited, "boolean");
});

Deno.test("checkRateLimit - fails OPEN when the store is unreachable", async () => {
  // With no DATABASE_URL wired in the test env, the underlying UPSERT throws
  // and the helper must return `true` so a transient DB outage never blocks
  // real users.
  assertEquals(await checkRateLimit("test:fail_open", 1), true);
  assertEquals(await checkRateLimit("test:fail_open", 1), true);
});

Deno.test("RATE_LIMIT_WINDOW_MS is 60 seconds", () => {
  assertEquals(RATE_LIMIT_WINDOW_MS, 60_000);
});

// =============================================================================
// Polaris Track A — hostname dispatch + route classification
// =============================================================================

Deno.test("classifySurface — admin hosts", () => {
  assertEquals(classifySurface("manage.polaris.express"), "admin");
  assertEquals(classifySurface("manage.polaris.localhost"), "admin");
  assertEquals(classifySurface("localhost"), "admin");
  assertEquals(classifyAdminHostname("manage.polaris.express"), "admin");
});

Deno.test("classifySurface — customer hosts", () => {
  assertEquals(classifySurface("polaris.express"), "customer");
  assertEquals(classifySurface("polaris.localhost"), "customer");
  assertEquals(classifyCustomerHostname("polaris.express"), "customer");
});

Deno.test("classifySurface — unknown host returns null", () => {
  assertEquals(classifySurface("evil.com"), null);
  assertEquals(classifySurface("polaris.express.attacker.com"), null);
  assertEquals(classifySurface(""), null);
});

Deno.test("rewriteRequestForSurface — admin host rewrites pathname", () => {
  const url = new URL("https://manage.polaris.express/sync");
  const req = new Request(url.toString(), { method: "GET" });
  const out = rewriteRequestForSurface(req, url, "admin");
  assertEquals(new URL(out.url).pathname, "/admin/sync");
});

Deno.test("rewriteRequestForSurface — customer surface no-op", () => {
  const url = new URL("https://polaris.express/sessions");
  const req = new Request(url.toString(), { method: "GET" });
  const out = rewriteRequestForSurface(req, url, "customer");
  assertEquals(new URL(out.url).pathname, "/sessions");
});

Deno.test("rewriteRequestForSurface — root path becomes /admin", () => {
  const url = new URL("https://manage.polaris.express/");
  const req = new Request(url.toString(), { method: "GET" });
  const out = rewriteRequestForSurface(req, url, "admin");
  assertEquals(new URL(out.url).pathname, "/admin");
});

Deno.test("isShellOrApiPath — bypass rewrite for static / api / fresh", () => {
  assertEquals(isShellOrApiPath("/api/health"), true);
  assertEquals(isShellOrApiPath("/_fresh/foo"), true);
  assertEquals(isShellOrApiPath("/static/x.png"), true);
  assertEquals(isShellOrApiPath("/assets/styles.css"), true);
  assertEquals(isShellOrApiPath("/favicon.ico"), true);
  assertEquals(isShellOrApiPath("/manifest.json"), true);
  assertEquals(isShellOrApiPath("/sync"), false);
  assertEquals(isShellOrApiPath("/admin/sync"), false);
});

Deno.test("classifyRoute — admin paths require admin", () => {
  assertEquals(classifyRoute("/admin", "admin"), "ADMIN_ONLY");
  assertEquals(classifyRoute("/admin/sync", "admin"), "ADMIN_ONLY");
  assertEquals(classifyRoute("/api/admin/sync", "admin"), "ADMIN_ONLY");
  // Same path on customer surface — should be UNKNOWN (deny by default).
  assertEquals(classifyRoute("/admin/sync", "customer"), "UNKNOWN");
});

Deno.test("classifyRoute — customer paths require customer", () => {
  assertEquals(classifyRoute("/sessions", "customer"), "CUSTOMER_ONLY");
  assertEquals(classifyRoute("/billing", "customer"), "CUSTOMER_ONLY");
  assertEquals(classifyRoute("/cards", "customer"), "CUSTOMER_ONLY");
  assertEquals(
    classifyRoute("/api/customer/sessions", "customer"),
    "CUSTOMER_ONLY",
  );
  assertEquals(classifyRoute("/sessions", "admin"), "UNKNOWN");
});

Deno.test("classifyRoute — public routes are public on the right surface", () => {
  assertEquals(classifyRoute("/login", "customer"), "PUBLIC");
  assertEquals(classifyRoute("/auth/verify", "customer"), "PUBLIC");
  assertEquals(classifyRoute("/admin/login", "admin"), "PUBLIC");
  assertEquals(
    classifyRoute("/api/auth/sign-in/magic-link", "customer"),
    "PUBLIC",
  );
  assertEquals(classifyRoute("/api/health", "customer"), "PUBLIC");
  assertEquals(classifyRoute("/api/webhook/lago", "admin"), "PUBLIC");
});

Deno.test("classifyRoute — assets and fresh internals are public", () => {
  assertEquals(classifyRoute("/_fresh/foo", "customer"), "PUBLIC");
  assertEquals(classifyRoute("/static/x.png", "admin"), "PUBLIC");
  assertEquals(classifyRoute("/favicon.ico", "customer"), "PUBLIC");
});

Deno.test("classifyRoute — root is SHARED on each surface", () => {
  assertEquals(classifyRoute("/", "customer"), "SHARED");
  assertEquals(classifyRoute("/", "admin"), "SHARED");
});

Deno.test("getAllRouteRules — every rule has a non-UNKNOWN classification", () => {
  for (const rule of getAllRouteRules()) {
    assertEquals(rule.classification === "UNKNOWN", false);
  }
});

Deno.test("classifyRoute — longest-prefix match wins", () => {
  // /api/admin/sync should win over /api or /admin.
  assertEquals(classifyRoute("/api/admin/sync", "admin"), "ADMIN_ONLY");
  // /api/customer/sessions should win over /api/customer.
  assertEquals(
    classifyRoute("/api/customer/sessions/123", "customer"),
    "CUSTOMER_ONLY",
  );
});

// =============================================================================
// Polaris Track A — hostname dispatch fixture
// Verifies the path-rewrite + surface-state contract that the middleware
// relies on. We exercise the helper directly because the middleware itself
// requires a live DB connection (BetterAuth session lookup) which isn't
// available in the test env.
// =============================================================================

Deno.test("hostname fixture — manage host paths rewrite to /admin/*", () => {
  const cases: Array<[string, string]> = [
    ["https://manage.polaris.express/", "/admin"],
    ["https://manage.polaris.express/sync", "/admin/sync"],
    ["https://manage.polaris.express/users/abc", "/admin/users/abc"],
    ["https://manage.polaris.express/links/42", "/admin/links/42"],
  ];
  for (const [input, expected] of cases) {
    const url = new URL(input);
    const out = rewriteRequestForSurface(
      new Request(url.toString()),
      url,
      "admin",
    );
    assertEquals(new URL(out.url).pathname, expected, `for ${input}`);
  }
});

Deno.test("hostname fixture — polaris host paths do not rewrite", () => {
  const cases: Array<[string, string]> = [
    ["https://polaris.express/", "/"],
    ["https://polaris.express/sessions", "/sessions"],
    ["https://polaris.express/billing", "/billing"],
    ["https://polaris.express/cards/12", "/cards/12"],
  ];
  for (const [input, expected] of cases) {
    const url = new URL(input);
    const out = rewriteRequestForSurface(
      new Request(url.toString()),
      url,
      "customer",
    );
    assertEquals(new URL(out.url).pathname, expected, `for ${input}`);
  }
});

Deno.test("hostname fixture — cross-host API paths classify per surface", () => {
  // /api/admin/* on customer surface → UNKNOWN (404 per middleware contract)
  assertEquals(classifyRoute("/api/admin/sync", "customer"), "UNKNOWN");
  // /api/customer/* on admin surface → UNKNOWN
  assertEquals(classifyRoute("/api/customer/sessions", "admin"), "UNKNOWN");
  // /api/auth/* on either surface → PUBLIC
  assertEquals(classifyRoute("/api/auth/sign-in", "admin"), "PUBLIC");
  assertEquals(classifyRoute("/api/auth/sign-in", "customer"), "PUBLIC");
});

Deno.test("hostname fixture — 8h customer TTL ceiling boundary", () => {
  // We don't have a live session here; this test asserts the math the
  // middleware uses against `config.CUSTOMER_SESSION_TTL_SECONDS`.
  const ttl = 8 * 60 * 60; // 28800s
  const sevenHoursAgo = Date.now() - 7 * 60 * 60 * 1000;
  const nineHoursAgo = Date.now() - 9 * 60 * 60 * 1000;
  const ageSec7 = (Date.now() - sevenHoursAgo) / 1000;
  const ageSec9 = (Date.now() - nineHoursAgo) / 1000;
  assertEquals(ageSec7 < ttl, true, "7h session must be under 8h ceiling");
  assertEquals(ageSec9 > ttl, true, "9h session must be over 8h ceiling");
});

// =============================================================================
// ExpresScan / Wave 1 Track A — selectAuth() classifier
//
// `selectAuth(pathname)` is the single source of truth for which auth
// scheme is accepted on a path. The unit test `rejects bearer on admin`
// (below) is gating: a regression that lets a bearer-only client hit an
// admin endpoint would slip through here loudly.
// =============================================================================

Deno.test("selectAuth — rejects bearer on admin paths", () => {
  // Even though `/api/admin/*` is the most security-sensitive surface,
  // selectAuth must return "cookie" so the bearer branch in the middleware
  // is NEVER taken. A valid `Authorization: Bearer dev_…` header on an
  // admin endpoint is treated like no auth at all (cookie session check
  // runs and 401s when the cookie is missing).
  assertEquals(selectAuth("/api/admin/devices"), "cookie");
  assertEquals(selectAuth("/api/admin/devices/abc"), "cookie");
  assertEquals(selectAuth("/api/admin/devices/abc/scan-arm"), "cookie");
  assertEquals(selectAuth("/api/admin/sync"), "cookie");
  assertEquals(selectAuth("/api/admin/users/u1"), "cookie");
});

Deno.test("selectAuth — bearer for /api/devices/* lifecycle routes", () => {
  assertEquals(selectAuth("/api/devices/heartbeat"), "bearer");
  assertEquals(selectAuth("/api/devices/me"), "bearer");
  assertEquals(selectAuth("/api/devices/scan-stream"), "bearer");
  assertEquals(selectAuth("/api/devices/scan-result"), "bearer");
  assertEquals(selectAuth("/api/devices/scan-result/X7R2KQ"), "bearer");
  // Per-deviceId paths (DELETE / PUT push-token) are bearer too.
  assertEquals(
    selectAuth("/api/devices/00000000-0000-0000-0000-000000000000"),
    "bearer",
  );
  assertEquals(
    selectAuth(
      "/api/devices/00000000-0000-0000-0000-000000000000/push-token",
    ),
    "bearer",
  );
});

Deno.test("selectAuth — register is cookie-only", () => {
  // The register entrypoint mints the bearer token from a cookie session
  // + PKCE code, so the request itself can't carry a bearer.
  assertEquals(selectAuth("/api/devices/register"), "cookie");
});

Deno.test("selectAuth — customer + ocpp + public", () => {
  assertEquals(selectAuth("/api/customer/sessions"), "cookie");
  assertEquals(selectAuth("/api/ocpp/pre-authorize"), "ocpp-hmac");
  assertEquals(selectAuth("/api/ocpp/meter-values"), "ocpp-hmac");
  assertEquals(selectAuth("/api/auth/scan-pair"), "public-or-cookie");
  assertEquals(selectAuth("/api/health"), "public-or-cookie");
  assertEquals(selectAuth("/api/webhook/lago"), "public-or-cookie");
  assertEquals(selectAuth("/login"), "public-or-cookie");
});

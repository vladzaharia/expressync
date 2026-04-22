/**
 * Tests for `src/lib/audit.ts` — auth audit helpers.
 *
 * Verifies the public contract:
 *   - `hashEmail` is deterministic + case-insensitive + uses sha256.
 *   - `logAuthEvent` swallows DB errors (best-effort) and returns void.
 *   - The named convenience helpers exist and are async.
 *
 * The actual DB write is exercised in integration tests (no DB available
 * in unit env — `db.insert(...)` throws and the helper must absorb it).
 */
import { assert, assertEquals } from "@std/assert";
import {
  hashEmail,
  logAuthEvent,
  logCapabilityDenied,
  logCustomerAccountAutoCreateBlockedAdminEmail,
  logCustomerAccountAutoProvisioned,
  logImpersonationStart,
  logMagicLinkConsumed,
  logMagicLinkFailed,
  logMagicLinkRequested,
  logPasswordLoginFailed,
  logScanLoginFailed,
  logScanLoginSuccess,
} from "./audit.ts";

Deno.test("hashEmail — deterministic", async () => {
  const a = await hashEmail("alice@example.com");
  const b = await hashEmail("alice@example.com");
  assertEquals(a, b);
});

Deno.test("hashEmail — case-insensitive (LOWER applied)", async () => {
  const lower = await hashEmail("alice@example.com");
  const upper = await hashEmail("ALICE@EXAMPLE.COM");
  const mixed = await hashEmail("Alice@Example.Com");
  assertEquals(lower, upper);
  assertEquals(lower, mixed);
});

Deno.test("hashEmail — strips surrounding whitespace", async () => {
  const padded = await hashEmail("  alice@example.com  ");
  const clean = await hashEmail("alice@example.com");
  assertEquals(padded, clean);
});

Deno.test("hashEmail — sha256 hex (64 chars, all hex)", async () => {
  const h = await hashEmail("alice@example.com");
  assertEquals(h.length, 64);
  assert(/^[0-9a-f]{64}$/.test(h), "must be lowercase hex");
});

Deno.test("hashEmail — different emails produce different hashes", async () => {
  const a = await hashEmail("alice@example.com");
  const b = await hashEmail("bob@example.com");
  assert(a !== b);
});

Deno.test("logAuthEvent — swallows DB errors (returns void without throwing)", async () => {
  // No DATABASE_URL in test env → underlying insert throws.
  // The helper must absorb it silently.
  const result = await logAuthEvent("magic_link.requested", {
    email: "alice@example.com",
  });
  assertEquals(result, undefined);
});

Deno.test("logAuthEvent — accepts pre-hashed email", async () => {
  const result = await logAuthEvent("magic_link.requested", {
    emailHash: "a".repeat(64),
  });
  assertEquals(result, undefined);
});

Deno.test("convenience helpers — all return Promise<void>", async () => {
  // Each helper is just `logAuthEvent(EVENT, payload)`. Smoke-test them so
  // a renamed event identifier surfaces here rather than at runtime.
  await logMagicLinkRequested({ email: "alice@example.com" });
  await logMagicLinkConsumed({ userId: "u1" });
  await logMagicLinkFailed({ email: "alice@example.com" });
  await logScanLoginSuccess({ userId: "u1" });
  await logScanLoginFailed({});
  await logPasswordLoginFailed({ email: "admin@example.com" });
  await logImpersonationStart({ userId: "admin1" });
  await logCustomerAccountAutoProvisioned({ userId: "c1" });
  await logCapabilityDenied({ userId: "c1" });
  await logCustomerAccountAutoCreateBlockedAdminEmail({
    email: "admin@example.com",
  });
});

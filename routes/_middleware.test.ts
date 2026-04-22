import { assertEquals } from "@std/assert";
import {
  checkRateLimit,
  RATE_LIMIT_WINDOW_MS,
} from "@/src/lib/utils/rate-limit.ts";

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

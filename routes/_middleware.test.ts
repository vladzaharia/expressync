import { assertEquals } from "@std/assert";
import { checkRateLimit, rateLimitStore } from "@/src/lib/utils/rate-limit.ts";

// Clear shared state before each test to prevent interference
function resetStore() {
  rateLimitStore.clear();
}

Deno.test("checkRateLimit - allows requests under limit", () => {
  resetStore();
  const key = "test:under_limit";

  assertEquals(checkRateLimit(key, 5), true);
  assertEquals(checkRateLimit(key, 5), true);
  assertEquals(checkRateLimit(key, 5), true);
});

Deno.test("checkRateLimit - blocks requests at limit", () => {
  resetStore();
  const key = "test:at_limit";

  // Use up all allowed requests
  for (let i = 0; i < 3; i++) {
    assertEquals(checkRateLimit(key, 3), true);
  }

  // Next request should be blocked
  assertEquals(checkRateLimit(key, 3), false);
  assertEquals(checkRateLimit(key, 3), false);
});

Deno.test("checkRateLimit - window reset after timeout", () => {
  resetStore();
  const key = "test:window_reset";

  // Use up all allowed requests
  for (let i = 0; i < 2; i++) {
    assertEquals(checkRateLimit(key, 2), true);
  }
  assertEquals(checkRateLimit(key, 2), false);

  // Simulate window expiry by manually setting resetAt to the past
  const record = rateLimitStore.get(key)!;
  record.resetAt = Date.now() - 1;

  // Should be allowed again after window reset
  assertEquals(checkRateLimit(key, 2), true);
});

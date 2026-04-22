/**
 * Polaris Track C — docker-log-subscriber unit tests.
 *
 * The subscriber is a singleton fan-out wrapper around `dockerClient.streamLogs`.
 * Without a Docker socket in the test env, `subscribe()` returns
 * `{ available: false }`. We use that to assert the contract surface:
 *   - extractChargeBoxId regex covers the documented log formats
 *   - subscribe() handles unavailable Docker without throwing
 *   - unsubscribe is idempotent
 */

import { assertEquals } from "@std/assert";
import {
  _subscriberCountForTests,
  extractChargeBoxId,
  subscribe,
} from "./docker-log-subscriber.ts";

Deno.test("extractChargeBoxId — chargeBoxId='EVSE-1' single-quoted", () => {
  assertEquals(
    extractChargeBoxId("Authorize.req for chargeBoxId 'EVSE-1' received"),
    "EVSE-1",
  );
});

Deno.test("extractChargeBoxId — chargeBoxId=EVSE-2 unquoted equals", () => {
  assertEquals(
    extractChargeBoxId("[StEvE] chargeBoxId=EVSE-2 with idTag=BAD"),
    "EVSE-2",
  );
});

Deno.test("extractChargeBoxId — bracketed prefix [CB01]", () => {
  assertEquals(
    extractChargeBoxId("[CB01] Authorize.req received"),
    "CB01",
  );
});

Deno.test(
  "extractChargeBoxId — line without chargeBoxId returns null",
  () => {
    assertEquals(extractChargeBoxId("INFO: Server started on port 8080"), null);
  },
);

Deno.test(
  "subscribe — without Docker socket returns available:false",
  async () => {
    // Test env has no Docker socket → isAvailable returns false →
    // we get a synthetic-no-op subscriber back.
    const sub = await subscribe(() => {});
    assertEquals(sub.available, false);
    // unsubscribe must be a callable no-op.
    sub.unsubscribe();
    sub.unsubscribe(); // idempotent
  },
);

Deno.test(
  "subscribe — non-available subscribers don't accumulate in the bus",
  async () => {
    const before = _subscriberCountForTests();
    const sub = await subscribe(() => {});
    sub.unsubscribe();
    const after = _subscriberCountForTests();
    assertEquals(after, before);
  },
);

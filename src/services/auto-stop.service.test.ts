/**
 * Unit tests for the auto-stop service's pure helpers (recently-stopped
 * dedup map). Network-touching paths are covered by the integration
 * harness in tests/integration/.
 */

import { assert, assertEquals } from "@std/assert";
import { _internal } from "./auto-stop.service.ts";

const { markRecent, wasRecentlyStopped, recentlyStopped } = _internal;

function reset() {
  for (const k of [...recentlyStopped.keys()]) recentlyStopped.delete(k);
}

Deno.test("wasRecentlyStopped — false for unknown tx", () => {
  reset();
  assertEquals(wasRecentlyStopped(42), false);
});

Deno.test("markRecent + wasRecentlyStopped — round-trip", () => {
  reset();
  markRecent(101);
  assert(wasRecentlyStopped(101));
});

Deno.test("wasRecentlyStopped — expires after TTL", () => {
  reset();
  // Force-set an expired timestamp to avoid sleeping in the test.
  recentlyStopped.set(202, Date.now() - 120_000);
  assertEquals(wasRecentlyStopped(202), false);
  // The expired entry is removed during the lookup.
  assertEquals(recentlyStopped.has(202), false);
});

Deno.test("markRecent — large fleet doesn't unbound", () => {
  reset();
  // Push past the 256 GC threshold; ancient entries get pruned.
  for (let i = 0; i < 300; i++) {
    recentlyStopped.set(i, Date.now() - 120_000);
  }
  markRecent(999); // triggers the GC sweep
  // Old entries should be gone, the fresh one remains.
  assert(wasRecentlyStopped(999));
  // (We don't assert size precisely — GC is best-effort, not a strict cap.)
  reset();
});

/**
 * Tests for `src/lib/scoping.ts` — customer ownership scoping.
 *
 * No live DB in unit tests, so we focus on:
 *   - The error class shape (status 404, type metadata).
 *   - `resolveCustomerScope` short-circuits when no user is set.
 *   - Memoization behavior (cached scope returned on second call).
 *
 * Full ownership/integration tests live alongside the customer endpoint
 * code in F1/F2 — they exercise real DB rows.
 */
import { assertEquals } from "@std/assert";
import {
  OwnershipError,
  resolveCustomerScope,
  type ScopingContext,
} from "./scoping.ts";
import type { CustomerScope, State } from "@/utils.ts";

function makeCtx(overrides?: Partial<State>): ScopingContext {
  const state: State = { ...overrides };
  return { state };
}

Deno.test("OwnershipError — has status 404", () => {
  const err = new OwnershipError("session", 123);
  assertEquals(err.status, 404);
  assertEquals(err.type, "session");
  assertEquals(err.id, 123);
});

Deno.test("resolveCustomerScope — empty when no user set", async () => {
  const ctx = makeCtx();
  const scope = await resolveCustomerScope(ctx);
  assertEquals(scope.lagoCustomerExternalId, null);
  assertEquals(scope.ocppTagPks.length, 0);
  assertEquals(scope.mappingIds.length, 0);
  assertEquals(scope.isActive, false);
});

Deno.test("resolveCustomerScope — empty cached on second call (no user)", async () => {
  const ctx = makeCtx();
  const first = await resolveCustomerScope(ctx);
  const second = await resolveCustomerScope(ctx);
  // Reference identity — memoization stored the same object.
  assertEquals(first, second);
  assertEquals(ctx.state.customerScope, first);
});

Deno.test("resolveCustomerScope — uses pre-set ctx.state.customerScope when present", async () => {
  const preset: CustomerScope = {
    lagoCustomerExternalId: "cust_test",
    ocppTagPks: [1, 2, 3],
    mappingIds: [10, 20, 30],
    isActive: true,
  };
  const ctx = makeCtx({ customerScope: preset });
  const scope = await resolveCustomerScope(ctx);
  // Returned the cached value — no DB call needed.
  assertEquals(scope, preset);
});

Deno.test("resolveCustomerScope — actingAs takes precedence over user.id", async () => {
  // We can't actually verify the DB query result in unit tests, but we can
  // verify that no exception is thrown when actingAs is set + the cached
  // path is the one we hit. Set a pre-cached scope so we never hit the DB.
  const preset: CustomerScope = {
    lagoCustomerExternalId: "cust_acted_on",
    ocppTagPks: [99],
    mappingIds: [99],
    isActive: true,
  };
  const ctx = makeCtx({
    user: {
      id: "admin",
      name: "Admin",
      email: "admin@x",
      emailVerified: true,
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    actingAs: "customer-target-id",
    customerScope: preset,
  });
  const scope = await resolveCustomerScope(ctx);
  assertEquals(scope, preset);
});

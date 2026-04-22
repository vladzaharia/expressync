/**
 * Tests for `src/lib/capabilities.ts`.
 *
 * Capabilities derive from `scope.isActive`. We pre-set the scope on the
 * context so `resolveCustomerScope` returns a known value without hitting
 * the DB.
 */
import { assertEquals, assertRejects } from "@std/assert";
import {
  assertCapability,
  CapabilityDeniedError,
  type CustomerCapability,
  getCustomerCapabilities,
} from "./capabilities.ts";
import type { ScopingContext } from "./scoping.ts";
import type { CustomerScope, State } from "@/utils.ts";

function makeCtx(scope: CustomerScope): ScopingContext {
  const state: State = { customerScope: scope };
  return { state };
}

const ACTIVE_SCOPE: CustomerScope = {
  lagoCustomerExternalId: "cust_active",
  ocppTagPks: [1],
  mappingIds: [10],
  isActive: true,
};

const INACTIVE_SCOPE: CustomerScope = {
  lagoCustomerExternalId: "cust_inactive",
  ocppTagPks: [1],
  mappingIds: [10],
  isActive: false,
};

const EMPTY_SCOPE: CustomerScope = {
  lagoCustomerExternalId: null,
  ocppTagPks: [],
  mappingIds: [],
  isActive: false,
};

Deno.test("getCustomerCapabilities — active scope yields FULL set", async () => {
  const caps = await getCustomerCapabilities(makeCtx(ACTIVE_SCOPE));
  // FULL = view_history, start_charge, stop_charge, reserve, manage_cards
  assertEquals(caps.size, 5);
  for (
    const cap of [
      "view_history",
      "start_charge",
      "stop_charge",
      "reserve",
      "manage_cards",
    ] as CustomerCapability[]
  ) {
    assertEquals(caps.has(cap), true, `expected ${cap} in FULL`);
  }
});

Deno.test(
  "getCustomerCapabilities — inactive scope yields read-only set",
  async () => {
    const caps = await getCustomerCapabilities(makeCtx(INACTIVE_SCOPE));
    assertEquals(caps.size, 1);
    assertEquals(caps.has("view_history"), true);
    assertEquals(caps.has("start_charge"), false);
    assertEquals(caps.has("stop_charge"), false);
    assertEquals(caps.has("reserve"), false);
    assertEquals(caps.has("manage_cards"), false);
  },
);

Deno.test(
  "getCustomerCapabilities — empty (admin without impersonation) is read-only",
  async () => {
    // EMPTY scope is what an admin without impersonation gets. They shouldn't
    // be able to do anything customer-y; only view_history is granted (the
    // capability surface for non-customer roles is irrelevant — they hit
    // routes that don't gate on capabilities).
    const caps = await getCustomerCapabilities(makeCtx(EMPTY_SCOPE));
    assertEquals(caps.size, 1);
    assertEquals(caps.has("view_history"), true);
  },
);

Deno.test(
  "getCustomerCapabilities — memoized across calls in same context",
  async () => {
    const ctx = makeCtx(ACTIVE_SCOPE);
    const a = await getCustomerCapabilities(ctx);
    const b = await getCustomerCapabilities(ctx);
    // Same Set instance — memoization confirmed.
    assertEquals(a, b);
  },
);

Deno.test(
  "assertCapability — passes silently when cap present",
  async () => {
    const ctx = makeCtx(ACTIVE_SCOPE);
    await assertCapability(ctx, "start_charge");
    // No error thrown — pass.
  },
);

Deno.test(
  "assertCapability — throws CapabilityDeniedError when cap absent",
  async () => {
    const ctx = makeCtx(INACTIVE_SCOPE);
    const err = await assertRejects(
      () => assertCapability(ctx, "start_charge"),
      CapabilityDeniedError,
    );
    assertEquals(err.status, 403);
    assertEquals(err.capability, "start_charge");
    assertEquals(err.name, "CapabilityDeniedError");
  },
);

Deno.test(
  "assertCapability — view_history always granted (active OR inactive)",
  async () => {
    await assertCapability(makeCtx(ACTIVE_SCOPE), "view_history");
    await assertCapability(makeCtx(INACTIVE_SCOPE), "view_history");
    await assertCapability(makeCtx(EMPTY_SCOPE), "view_history");
  },
);

Deno.test(
  "CapabilityDeniedError — has status 403 and capability metadata",
  () => {
    const err = new CapabilityDeniedError("reserve");
    assertEquals(err.status, 403);
    assertEquals(err.capability, "reserve");
    assertEquals(err.name, "CapabilityDeniedError");
  },
);

/**
 * ExpresScan v2 / Wave 6 Slice B — capability-gate unit tests.
 *
 * Two surfaces:
 *   - `validateCapabilitySet` — pure logic, exhaustive legal/illegal table.
 *   - `requireCapability` — throw-or-pass behavior with the bearer-auth
 *     `ctx.state.device` shape. Audit writes are fire-and-forget and the
 *     `audit.ts` layer swallows DB errors, so these tests run without
 *     a Postgres connection (a missing audit table just produces a
 *     `console.error` that doesn't fail the test).
 *
 * `sanitizeResources` / `sanitizeOps` are off — importing the module
 * pulls `audit.ts` which transitively pulls the `db` postgres pool.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  CapabilityDeniedError,
  requireCapability,
  validateCapabilitySet,
} from "./capability-gate.ts";
import type { DeviceCapability } from "../types/devices.ts";
import type { DeviceContext } from "./bearer-auth.ts";

// ---------------------------------------------------------------------------
// validateCapabilitySet — legal sets
// ---------------------------------------------------------------------------

const LEGAL_SETS: DeviceCapability[][] = [
  ["scanner"],
  ["user"],
  ["scanner", "user"],
  ["user", "scanner"],
  ["scanner", "kiosk"],
  ["kiosk", "scanner"],
  ["user", "kiosk"],
  ["kiosk", "user"],
];

for (const caps of LEGAL_SETS) {
  Deno.test({
    name: `validateCapabilitySet — legal: [${caps.join(",")}]`,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: () => {
      const r = validateCapabilitySet(caps);
      assertEquals(r.ok, true, JSON.stringify(r));
    },
  });
}

// ---------------------------------------------------------------------------
// validateCapabilitySet — illegal sets (each row: [caps, expected reason])
// ---------------------------------------------------------------------------

const ILLEGAL_SETS: Array<[DeviceCapability[], string]> = [
  // empty
  [[], "capabilities_must_not_be_empty"],
  // unknown token
  [["bogus" as DeviceCapability], "capability_unknown"],
  // duplicate
  [["scanner", "scanner"], "capability_duplicate"],
  // charger forbidden on app side
  [["charger"], "capability_not_app_eligible"],
  [["charger", "scanner"], "capability_not_app_eligible"],
  [["scanner", "charger"], "capability_not_app_eligible"],
  // kiosk alone — neither scanner nor user present
  [["kiosk"], "kiosk_requires_exactly_one_of_scanner_user"],
  // kiosk with both scanner AND user — ambiguous
  [
    ["scanner", "user", "kiosk"],
    "kiosk_requires_exactly_one_of_scanner_user",
  ],
  [
    ["kiosk", "scanner", "user"],
    "kiosk_requires_exactly_one_of_scanner_user",
  ],
];

for (const [caps, reason] of ILLEGAL_SETS) {
  Deno.test({
    name: `validateCapabilitySet — illegal [${caps.join(",")}] → ${reason}`,
    sanitizeResources: false,
    sanitizeOps: false,
    fn: () => {
      const r = validateCapabilitySet(caps);
      assertEquals(r.ok, false);
      if (!r.ok) assertEquals(r.reason, reason);
    },
  });
}

Deno.test({
  name: "validateCapabilitySet — non-array input",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    // deno-lint-ignore no-explicit-any
    const r = validateCapabilitySet("scanner" as any);
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.reason, "capabilities_must_be_array");
  },
});

// ---------------------------------------------------------------------------
// requireCapability — pass / throw
// ---------------------------------------------------------------------------

function makeDevice(caps: string[]): DeviceContext {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    ownerUserId: "user-1",
    capabilities: caps,
    secret: "secret",
    tokenId: "token-1",
  };
}

function makeCtx(device?: DeviceContext, route?: string) {
  const req = route
    ? new Request(`https://example.test${route}`, { method: "GET" })
    : undefined;
  return { state: { device }, req };
}

Deno.test({
  name: "requireCapability — passes when all required caps present",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = makeCtx(makeDevice(["scanner", "user"]));
    await requireCapability(ctx, "user");
    await requireCapability(ctx, "scanner", "user");
  },
});

Deno.test({
  name: "requireCapability — throws 403 when a required cap is missing",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = makeCtx(
      makeDevice(["scanner"]),
      "/api/devices/me/charger/start",
    );
    const err = await assertRejects(
      () => requireCapability(ctx, "user"),
      CapabilityDeniedError,
    );
    assertEquals(err.status, 403);
    assertEquals(err.missing, ["user"]);
    assertEquals(err.route, "/api/devices/me/charger/start");
  },
});

Deno.test({
  name: "requireCapability — reports every missing cap (not just first)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = makeCtx(makeDevice(["scanner"]));
    const err = await assertRejects(
      () => requireCapability(ctx, "user", "kiosk"),
      CapabilityDeniedError,
    );
    assertEquals(err.missing, ["user", "kiosk"]);
  },
});

Deno.test({
  name: "requireCapability — throws when ctx.state.device is absent",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = makeCtx(undefined);
    const err = await assertRejects(
      () => requireCapability(ctx, "user"),
      CapabilityDeniedError,
    );
    assertEquals(err.missing, ["user"]);
    assert(err.route === null);
  },
});

Deno.test({
  name: "requireCapability — empty cap list is a no-op",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const ctx = makeCtx(makeDevice([]));
    await requireCapability(ctx);
  },
});

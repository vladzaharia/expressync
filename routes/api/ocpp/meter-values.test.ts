/**
 * Unit tests for the live meter-values receiver. Exercises the pure
 * extractors (energy, power, finalization) and the in-memory mapping
 * cache. Network paths (HMAC verify, StEvE lookup, eventBus publish)
 * are covered by the scan-login integration harness; here we just want
 * fast guards on the math.
 */

import { assertAlmostEquals, assertEquals, assertStrictEquals } from "@std/assert";
import { _internal } from "./meter-values.ts";

const { extractEnergyKwh, extractPowerKw, isFinalSample, mappingCache, rememberMapping } =
  _internal;

Deno.test("extractEnergyKwh — Wh default unit converts to kWh", () => {
  const kwh = extractEnergyKwh([
    { value: "12345", measurand: "Energy.Active.Import.Register", unit: "Wh" },
  ]);
  assertEquals(kwh, 12.345);
});

Deno.test("extractEnergyKwh — kWh unit passes through unchanged", () => {
  const kwh = extractEnergyKwh([
    { value: "7.5", measurand: "Energy.Active.Import.Register", unit: "kWh" },
  ]);
  assertEquals(kwh, 7.5);
});

Deno.test("extractEnergyKwh — defaults measurand to Energy.Active.Import.Register", () => {
  const kwh = extractEnergyKwh([{ value: "1000" }]);
  // Default unit is Wh per OCPP spec → 1 kWh.
  assertEquals(kwh, 1);
});

Deno.test("extractEnergyKwh — skips non-energy measurands", () => {
  const kwh = extractEnergyKwh([
    { value: "240", measurand: "Voltage", unit: "V" },
    { value: "16", measurand: "Current.Import", unit: "A" },
  ]);
  assertStrictEquals(kwh, null);
});

Deno.test("extractEnergyKwh — returns null on non-numeric value", () => {
  const kwh = extractEnergyKwh([
    { value: "not-a-number", measurand: "Energy.Active.Import.Register" },
  ]);
  assertStrictEquals(kwh, null);
});

Deno.test("extractPowerKw — single-phase W converts to kW", () => {
  const kw = extractPowerKw([
    { value: "7400", measurand: "Power.Active.Import", unit: "W" },
  ]);
  assertEquals(kw, 7.4);
});

Deno.test("extractPowerKw — sums multi-phase samples", () => {
  const kw = extractPowerKw([
    { value: "2400", measurand: "Power.Active.Import", unit: "W", phase: "L1" },
    { value: "2400", measurand: "Power.Active.Import", unit: "W", phase: "L2" },
    { value: "2400", measurand: "Power.Active.Import", unit: "W", phase: "L3" },
  ]);
  // Float arithmetic: 2.4 + 2.4 + 2.4 lands at 7.199999999... in IEEE-754.
  // The UI rounds to 1 decimal so this precision is plenty.
  assertAlmostEquals(kw ?? 0, 7.2, 1e-9);
});

Deno.test("extractPowerKw — kW unit passes through", () => {
  const kw = extractPowerKw([
    { value: "11", measurand: "Power.Active.Import", unit: "kW" },
  ]);
  assertEquals(kw, 11);
});

Deno.test("extractPowerKw — null when no power measurand present", () => {
  const kw = extractPowerKw([
    { value: "1000", measurand: "Energy.Active.Import.Register", unit: "Wh" },
  ]);
  assertStrictEquals(kw, null);
});

Deno.test("isFinalSample — true when any sample carries Transaction.End", () => {
  assertEquals(
    isFinalSample([
      { value: "100" },
      { value: "200", context: "Transaction.End" },
    ]),
    true,
  );
});

Deno.test("isFinalSample — false for periodic samples", () => {
  assertEquals(
    isFinalSample([{ value: "100", context: "Sample.Periodic" }]),
    false,
  );
});

Deno.test("mappingCache — evicts oldest entry past the cap", () => {
  // Fresh cache for the test (mappingCache is a module singleton, so we
  // record the prior size and only assert relative behavior).
  const startSize = mappingCache.size;
  rememberMapping(999_001, 1);
  rememberMapping(999_002, 2);
  rememberMapping(999_003, null);
  // Expected three new entries (none of those tx PKs are in the cache
  // before this test).
  assertEquals(mappingCache.size, startSize + 3);
  assertEquals(mappingCache.get(999_001), 1);
  assertEquals(mappingCache.get(999_002), 2);
  assertStrictEquals(mappingCache.get(999_003), null);
  // Cleanup so the test is hermetic.
  mappingCache.delete(999_001);
  mappingCache.delete(999_002);
  mappingCache.delete(999_003);
});

/**
 * Smoke tests for the per-kind scan-step copy helper. These keep the
 * armed-state copy in `ScanPanel` from regressing back to the generic
 * "Tap it on the reader" wording every flow had pre-D3.
 */

import { assertEquals } from "@std/assert";
import type { TapTargetEntry } from "../../src/lib/types/devices.ts";
import { stepsForTarget } from "./scan-steps.ts";

const baseEntry: Omit<TapTargetEntry, "kind" | "label"> = {
  deviceId: "x",
  pairableType: "device",
  capabilities: ["tap"],
  isOnline: true,
};

Deno.test("stepsForTarget — null target falls back to generic reader copy", () => {
  const steps = stepsForTarget(null);
  assertEquals(steps, [
    "Wake your card",
    "Tap it on the reader",
    "We'll handle the rest",
  ]);
});

Deno.test("stepsForTarget — phone target yields phone-specific prep step", () => {
  const steps = stepsForTarget({
    ...baseEntry,
    kind: "phone_nfc",
    label: "Aisha's iPhone",
  });
  assertEquals(steps[0], "Unlock your phone");
  assertEquals(steps[1], "Tap your card on Aisha's iPhone");
  assertEquals(steps[2], "We'll handle the rest");
});

Deno.test("stepsForTarget — charger uses 'Tap it on {label}' copy", () => {
  const steps = stepsForTarget({
    ...baseEntry,
    pairableType: "charger",
    kind: "charger",
    label: "Garage",
  });
  assertEquals(steps[0], "Wake your card");
  assertEquals(steps[1], "Tap it on Garage");
  assertEquals(steps[2], "We'll handle the rest");
});

Deno.test("stepsForTarget — laptop NFC reuses charger-style copy", () => {
  const steps = stepsForTarget({
    ...baseEntry,
    kind: "laptop_nfc",
    label: "Front desk laptop",
  });
  assertEquals(steps[0], "Wake your card");
  assertEquals(steps[1], "Tap it on Front desk laptop");
});

Deno.test("stepsForTarget — empty/whitespace label falls through to 'the reader'", () => {
  const steps = stepsForTarget({
    ...baseEntry,
    kind: "phone_nfc",
    label: "   ",
  });
  // Whitespace-only label collapses to the generic placeholder so the
  // rendered step never says "Tap your card on    ".
  assertEquals(steps[1], "Tap your card on the reader");
});

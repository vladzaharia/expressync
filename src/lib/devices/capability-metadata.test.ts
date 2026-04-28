/**
 * Capability-metadata kind-aware picker option tests.
 */

import { assertEquals } from "@std/assert";
import {
  APP_REGISTRATION_OPTIONS,
  CAPABILITY_METADATA,
  pickerOptionsForKind,
} from "./capability-metadata.ts";

Deno.test("pickerOptionsForKind — phone_nfc: editable {scanner,user,kiosk}", () => {
  const opts = pickerOptionsForKind("phone_nfc");
  assertEquals(Array.from(opts.editable).sort(), ["kiosk", "scanner", "user"]);
  assertEquals(opts.readOnly, []);
});

Deno.test("pickerOptionsForKind — laptop_nfc: same as phone", () => {
  const opts = pickerOptionsForKind("laptop_nfc");
  assertEquals(Array.from(opts.editable).sort(), ["kiosk", "scanner", "user"]);
  assertEquals(opts.readOnly, []);
});

Deno.test("pickerOptionsForKind — charger: scanner editable, charger read-only", () => {
  const opts = pickerOptionsForKind("charger");
  assertEquals(Array.from(opts.editable), ["scanner"]);
  assertEquals(Array.from(opts.readOnly), ["charger"]);
});

Deno.test("pickerOptionsForKind — unknown kind defaults to app picker", () => {
  const opts = pickerOptionsForKind("future_unknown");
  assertEquals(Array.from(opts.editable).sort(), ["kiosk", "scanner", "user"]);
});

Deno.test("APP_REGISTRATION_OPTIONS excludes charger", () => {
  assertEquals(APP_REGISTRATION_OPTIONS.includes("charger" as never), false);
  assertEquals(APP_REGISTRATION_OPTIONS.length, 3);
});

Deno.test("CAPABILITY_METADATA covers every capability", () => {
  for (const c of ["scanner", "charger", "user", "kiosk"] as const) {
    assertEquals(CAPABILITY_METADATA[c].capability, c);
    assertEquals(typeof CAPABILITY_METADATA[c].label, "string");
    assertEquals(typeof CAPABILITY_METADATA[c].description, "string");
  }
});

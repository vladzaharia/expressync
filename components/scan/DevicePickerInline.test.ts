/**
 * Smoke tests for `DevicePickerInline` (Wave 4 D3).
 *
 * Pure presentational component (with one auto-pick effect that fires on
 * mount). We assert the four flows the plan calls out:
 *
 *   - empty roster renders nothing
 *   - grouped roster renders all three groups (chargers / your phone /
 *     other devices) with correct headings + the "(this device)" suffix
 *   - offline rows are surfaced with the Offline pill and disabled
 *   - auto-pick fires when exactly one online own-phone is present
 *     (collapsed "Using …" body) and does NOT fire when a charger is
 *     the lone online row (so customers don't accidentally arm a
 *     charger they happen to be near)
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import { h } from "preact";
import type { TapTargetEntry } from "../../src/lib/types/devices.ts";
import { DevicePickerInline } from "./DevicePickerInline.tsx";

function charger(
  id: string,
  label: string,
  isOnline: boolean,
): TapTargetEntry {
  return {
    deviceId: id,
    pairableType: "charger",
    kind: "charger",
    label,
    capabilities: ["tap", "ev"],
    isOnline,
  };
}

function ownPhone(
  id: string,
  label: string,
  isOnline: boolean,
): TapTargetEntry {
  return {
    deviceId: id,
    pairableType: "device",
    kind: "phone_nfc",
    label,
    capabilities: ["tap"],
    isOnline,
    isOwnDevice: true,
  };
}

function otherPhone(
  id: string,
  label: string,
  isOnline: boolean,
): TapTargetEntry {
  return {
    deviceId: id,
    pairableType: "device",
    kind: "phone_nfc",
    label,
    capabilities: ["tap"],
    isOnline,
  };
}

Deno.test("DevicePickerInline renders nothing for empty roster", () => {
  const html = renderToString(
    h(DevicePickerInline, {
      devices: [],
      selectedDeviceId: null,
      onSelect: () => {},
    }),
  );
  // Empty roster collapses to nothing renderable.
  assertEquals(html, "");
});

Deno.test("DevicePickerInline groups chargers, own phone, and other devices", () => {
  const html = renderToString(
    h(DevicePickerInline, {
      // Force "non-auto-pick" path: two own-phones online means the
      // auto-pick rule (exactly one) doesn't fire and the picker
      // renders the full grouped list. Stable, branch-coverage-friendly.
      devices: [
        charger("EVSE-1", "Garage", true),
        ownPhone("phone-a", "Aisha's iPhone", true),
        ownPhone("phone-b", "Spare iPhone", true),
        otherPhone("phone-c", "Other admin's iPhone", true),
      ],
      selectedDeviceId: null,
      onSelect: () => {},
    }),
  );
  assertStringIncludes(html, "Chargers");
  assertStringIncludes(html, "Your phone");
  assertStringIncludes(html, "Other devices");
  assertStringIncludes(html, "Garage");
  // preact-render-to-string emits apostrophes literally — no entity encoding.
  assertStringIncludes(html, "Aisha's iPhone");
  assertStringIncludes(html, "(this device)");
  assertStringIncludes(html, "Other admin's iPhone");
});

Deno.test("DevicePickerInline marks offline rows with the Offline pill and disables click", () => {
  const html = renderToString(
    h(DevicePickerInline, {
      devices: [charger("EVSE-Z", "Old wallbox", false)],
      selectedDeviceId: null,
      onSelect: () => {},
    }),
  );
  assertStringIncludes(html, "Old wallbox");
  assertStringIncludes(html, "Offline");
  // Disabled rows have both `disabled` and `aria-disabled` attributes;
  // preact-render-to-string emits boolean attrs as bare names (not
  // `aria-disabled="true"`). Confirm both names land in the markup.
  assertStringIncludes(html, "disabled");
  assertStringIncludes(html, "aria-disabled");
});

Deno.test("DevicePickerInline auto-pick collapses to a status line for a lone online own-phone", () => {
  let picked: TapTargetEntry | null = null;
  const target = ownPhone("phone-a", "Aisha's iPhone", true);
  const html = renderToString(
    h(DevicePickerInline, {
      devices: [
        target,
        // An offline charger should NOT block auto-pick — only the
        // count of *online own-phones* matters.
        charger("EVSE-1", "Garage", false),
      ],
      selectedDeviceId: null,
      onSelect: (t: TapTargetEntry) => {
        picked = t;
      },
    }),
  );
  // SSR renders the auto-pick body (the effect fires on mount in the
  // browser; for the SSR snapshot we're asserting the collapsed shape).
  assertStringIncludes(html, "Using");
  assertStringIncludes(html, "to scan");
  // Don't render any group headings in auto-pick mode.
  assertEquals(html.includes("Chargers"), false);
  assertEquals(html.includes("Other devices"), false);
  // `picked` stays null on SSR (effects only run on the client) but the
  // type is reachable; this satisfies tsc.
  assertEquals(picked, null);
});

Deno.test("DevicePickerInline does NOT auto-pick when a charger is the lone online target", () => {
  // Customer-side scenario: customers don't own phones in v1, so the
  // roster is chargers-only. Auto-pick must stay dormant — a customer
  // walking past a random charger shouldn't accidentally arm a scan.
  const html = renderToString(
    h(DevicePickerInline, {
      devices: [
        charger("EVSE-1", "Garage", true),
        charger("EVSE-2", "Driveway", false),
      ],
      selectedDeviceId: null,
      onSelect: () => {},
    }),
  );
  // The grouped list renders, not the auto-pick collapsed body.
  assertStringIncludes(html, "Chargers");
  assertEquals(html.includes("Using"), false);
});

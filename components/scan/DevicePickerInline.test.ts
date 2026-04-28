/**
 * Smoke tests for `DevicePickerInline` (post-Wave-5 unified flow).
 *
 * Flat list, no auto-pick, no kind-based grouping. We assert:
 *   - empty roster renders nothing
 *   - admin mode renders every row, online + offline
 *   - customer mode hides offline non-charger rows
 *   - offline rows render disabled with the Offline pill
 *   - online-first sort places online rows above offline rows
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
    friendlyName: label,
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
    friendlyName: label,
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
    friendlyName: label,
    capabilities: ["tap"],
    isOnline,
  };
}

Deno.test("renders nothing for empty roster", () => {
  const html = renderToString(
    h(DevicePickerInline, {
      devices: [],
      selectedDeviceId: null,
      onSelect: () => {},
    }),
  );
  assertEquals(html, "");
});

Deno.test("admin mode renders all rows, online and offline", () => {
  const html = renderToString(
    h(DevicePickerInline, {
      devices: [
        charger("EVSE-1", "Garage", true),
        ownPhone("phone-a", "Aisha's iPhone", true),
        otherPhone("phone-c", "Other admin's iPhone", false),
      ],
      selectedDeviceId: null,
      onSelect: () => {},
      mode: "admin",
    }),
  );
  assertStringIncludes(html, "Garage");
  assertStringIncludes(html, "Aisha's iPhone");
  assertStringIncludes(html, "Other admin's iPhone");
  assertStringIncludes(html, "Online");
  assertStringIncludes(html, "Offline");
  assertStringIncludes(html, "(this device)");
});

Deno.test("customer mode hides offline non-charger rows", () => {
  const html = renderToString(
    h(DevicePickerInline, {
      devices: [
        charger("EVSE-1", "Garage", false), // offline charger: visible
        ownPhone("phone-a", "Aisha's iPhone", true), // online phone: visible
        otherPhone("phone-c", "Stale iPhone", false), // offline phone: hidden
      ],
      selectedDeviceId: null,
      onSelect: () => {},
      mode: "customer",
    }),
  );
  assertStringIncludes(html, "Garage");
  assertStringIncludes(html, "Aisha's iPhone");
  // Stale offline non-charger MUST be filtered for customers.
  assertEquals(html.includes("Stale iPhone"), false);
});

Deno.test("offline rows render with Offline pill and disabled state", () => {
  const html = renderToString(
    h(DevicePickerInline, {
      devices: [charger("EVSE-1", "Garage", false)],
      selectedDeviceId: null,
      onSelect: () => {},
    }),
  );
  assertStringIncludes(html, "Offline");
  assertStringIncludes(html, "disabled");
});

Deno.test("online rows render before offline rows in admin mode", () => {
  const html = renderToString(
    h(DevicePickerInline, {
      devices: [
        charger("EVSE-A", "Alpha", false), // offline
        charger("EVSE-B", "Bravo", true), // online — should sort first
      ],
      selectedDeviceId: null,
      onSelect: () => {},
      mode: "admin",
    }),
  );
  const alphaIdx = html.indexOf("Alpha");
  const bravoIdx = html.indexOf("Bravo");
  // Online comes first.
  assertEquals(bravoIdx > 0 && alphaIdx > 0 && bravoIdx < alphaIdx, true);
});

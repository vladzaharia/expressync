/**
 * Polaris Track E — smoke tests for `ChargerPickerInline`.
 *
 * Pure presentational component. We assert that:
 *   - empty array renders nothing (the parent island handles the empty UX)
 *   - each charger row shows the friendly name when present, falls back to
 *     chargeBoxId, and surfaces a status pill
 *   - offline chargers render with the "Offline" pill (so the UX surfaces
 *     why the row is disabled)
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import { h } from "preact";
import { ChargerPickerInline } from "./ChargerPickerInline.tsx";

Deno.test("ChargerPickerInline renders nothing for empty list", () => {
  const html = renderToString(
    h(ChargerPickerInline, {
      chargers: [],
      onSelect: () => {},
    }),
  );
  assertEquals(html, "");
});

Deno.test("ChargerPickerInline renders friendly name + status for each charger", () => {
  const html = renderToString(
    h(ChargerPickerInline, {
      chargers: [
        {
          chargeBoxId: "EVSE-1",
          friendlyName: "Garage",
          status: "available",
          online: true,
        },
        {
          chargeBoxId: "EVSE-2",
          friendlyName: "Driveway",
          status: "occupied",
          online: true,
        },
      ],
      onSelect: () => {},
    }),
  );
  assertStringIncludes(html, "Garage");
  assertStringIncludes(html, "Driveway");
  assertStringIncludes(html, "Available");
  assertStringIncludes(html, "Occupied");
});

Deno.test("ChargerPickerInline falls back to chargeBoxId when friendlyName missing", () => {
  const html = renderToString(
    h(ChargerPickerInline, {
      chargers: [
        {
          chargeBoxId: "EVSE-9",
          friendlyName: null,
          status: "available",
          online: true,
        },
      ],
      onSelect: () => {},
    }),
  );
  assertStringIncludes(html, "EVSE-9");
});

Deno.test("ChargerPickerInline surfaces Offline pill for offline chargers", () => {
  const html = renderToString(
    h(ChargerPickerInline, {
      chargers: [
        {
          chargeBoxId: "EVSE-Z",
          friendlyName: "Old wallbox",
          status: "available",
          online: false,
        },
      ],
      onSelect: () => {},
    }),
  );
  assertStringIncludes(html, "Old wallbox");
  assertStringIncludes(html, "Offline");
});

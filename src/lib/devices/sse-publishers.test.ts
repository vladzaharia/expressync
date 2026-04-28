/**
 * sse-publishers.ts — verifies the publishers route through the event
 * bus and respect deviceId filtering. Also exercises the same
 * subscription seam used by `scan-stream.ts` (the live subscription
 * was extended in slice D to include `device.capabilities.changed`
 * and `device.settings.changed`); we assert subscribing on both event
 * types delivers the matching events filtered by deviceId.
 */

import { assertEquals } from "@std/assert";
import {
  publishDeviceCapabilitiesChanged,
  publishDeviceSettingsChanged,
} from "./sse-publishers.ts";
import { eventBus } from "../../services/event-bus.service.ts";

Deno.test({
  name: "sse-publishers — capabilities event reaches matching subscriber",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    eventBus._reset();
    const targetDevice = crypto.randomUUID();
    const otherDevice = crypto.randomUUID();
    const observed: { type: string; deviceId: string }[] = [];

    // Subscribe with the same multi-type subscription that scan-stream
    // uses post-slice-D — proves the new types are routable.
    const unsub = eventBus.subscribe(
      [
        "device.scan.requested",
        "device.capabilities.changed",
        "device.settings.changed",
      ],
      (ev) => {
        const p = ev.payload as { deviceId: string };
        if (p.deviceId !== targetDevice) return;
        observed.push({ type: ev.type, deviceId: p.deviceId });
      },
    );

    publishDeviceCapabilitiesChanged(targetDevice, ["scanner", "user"]);
    publishDeviceCapabilitiesChanged(otherDevice, ["scanner"]);
    publishDeviceSettingsChanged(targetDevice, ["device.label"]);

    assertEquals(observed.length, 2);
    assertEquals(observed[0].type, "device.capabilities.changed");
    assertEquals(observed[0].deviceId, targetDevice);
    assertEquals(observed[1].type, "device.settings.changed");
    assertEquals(observed[1].deviceId, targetDevice);
    unsub();
  },
});

Deno.test({
  name: "sse-publishers — settings event carries changed-key list",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    eventBus._reset();
    const deviceId = crypto.randomUUID();
    let captured: string[] = [];
    const unsub = eventBus.subscribe(
      ["device.settings.changed"],
      (ev) => {
        const p = ev.payload as { deviceId: string; keys: string[] };
        if (p.deviceId === deviceId) captured = p.keys;
      },
    );
    publishDeviceSettingsChanged(deviceId, [
      "device.label",
      "notifications.scanRequest",
    ]);
    assertEquals(captured, ["device.label", "notifications.scanRequest"]);
    unsub();
  },
});

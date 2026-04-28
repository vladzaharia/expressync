/**
 * ExpresScan v2 / Wave 6 Slice C — device-state SSE publishers.
 *
 * Slice C only adds the publishers; slice D wires them from the admin
 * PATCH endpoints (`/api/admin/devices/{id}/capabilities` and
 * `/api/admin/devices/{id}/settings`). The matching device's coordinator
 * (iOS slice G) listens on the existing `/api/devices/scan-stream` SSE
 * endpoint and pulls a fresh `me/state` envelope on receipt.
 *
 * Filtering: scan-stream filters published events by `payload.deviceId`
 * (see `routes/api/devices/scan-stream.ts:replay loop`), so each device
 * only sees events targeting itself. The publishers below carry
 * `deviceId` in the payload so that filter applies cleanly.
 *
 * Best-effort: a publish failure is logged but never re-thrown — the
 * admin write that triggered it succeeded; the client will pick up the
 * change on its next periodic sync (worst case ~60s latency).
 */

import { eventBus } from "../../services/event-bus.service.ts";
import type {
  DeviceCapabilitiesChangedPayload,
  DeviceCapability,
  DeviceSettingsChangedPayload,
} from "../types/devices.ts";
import { logger } from "../utils/logger.ts";

const log = logger.child("DeviceSsePublishers");

/**
 * Publish `device.capabilities.changed` for `deviceId`. Called by the
 * admin capabilities-PATCH endpoint after the DB row is updated.
 *
 * Filter: scan-stream's `payload.deviceId !== deviceId` skip drops the
 * event for every other open stream; only the matching device receives
 * it.
 */
export function publishDeviceCapabilitiesChanged(
  deviceId: string,
  capabilities: readonly DeviceCapability[],
): void {
  const payload: DeviceCapabilitiesChangedPayload = {
    deviceId,
    capabilities: [...capabilities],
  };
  try {
    eventBus.publish({ type: "device.capabilities.changed", payload });
  } catch (err) {
    log.warn("Failed to publish device.capabilities.changed", {
      deviceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Publish `device.settings.changed` for `deviceId`. Called by the admin
 * settings-PATCH endpoint with the list of keys that changed in this
 * write. The iOS coordinator re-fetches the envelope; the key list lets
 * a UI badge "this admin just edited X" without a diff.
 */
export function publishDeviceSettingsChanged(
  deviceId: string,
  changedKeys: readonly string[],
): void {
  const payload: DeviceSettingsChangedPayload = {
    deviceId,
    keys: [...changedKeys],
  };
  try {
    eventBus.publish({ type: "device.settings.changed", payload });
  } catch (err) {
    log.warn("Failed to publish device.settings.changed", {
      deviceId,
      keyCount: changedKeys.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * ExpresScan / Wave 1 Track A — shared device types.
 *
 * Single source of truth for cross-track contracts. Mirrored as Swift
 * `Codable` structs in `expresscan/Sources/Models/`. Changes here require
 * sign-off from all three implementation tracks (backend, frontend, iOS).
 *
 * See `expresscan/docs/plan/20-contracts.md` for the canonical spec.
 */

/**
 * Form-factor of a registered NFC reader device.
 *
 * `tablet_nfc` is reserved for future iPadOS support — only iPhones
 * register today, but the kind is wired through types/UI so adding tablet
 * registration later doesn't require a UI sweep.
 */
export const DEVICE_KINDS = ["phone_nfc", "tablet_nfc", "laptop_nfc"] as const;
export type DeviceKind = typeof DEVICE_KINDS[number];

/** Capability tokens granted to a device on register. */
export const DEVICE_CAPABILITIES = ["tap", "ev"] as const;
export type DeviceCapability = typeof DEVICE_CAPABILITIES[number];

/**
 * What the scan is for. Drives downstream UI + `scan.intercepted` event
 * routing. `login` is the existing customer scan-to-login flow; the rest
 * are new with ExpresScan.
 */
export const SCAN_PURPOSES = [
  /** Admin scanning to link a tag to a customer. */
  "admin-link",
  /** Customer adding a card to their own account. */
  "customer-link",
  /** Scan-to-login (existing customer flow). */
  "login",
  /** Admin or customer looking up a card without modifying anything. */
  "view-card",
] as const;
export type ScanPurpose = typeof SCAN_PURPOSES[number];

/**
 * Trimmed admin-list / detail view of a device row. Wire shape only —
 * never includes `pushToken`, raw bearer, or the device's HMAC `secret`.
 */
export interface DeviceSummary {
  deviceId: string;
  kind: DeviceKind;
  label: string;
  capabilities: DeviceCapability[];
  /** Always non-null for phone/laptop devices; null only for charger placeholders. */
  ownerUserId: string | null;
  platform: string | null;
  model: string | null;
  appVersion: string | null;
  lastSeenAtIso: string | null;
  /** Server-derived from `last_seen_at` cutoff. */
  isOnline: boolean;
  registeredAtIso: string;
}

/**
 * One row of the unified scan-target picker. Returned by
 * `GET /api/auth/scan-tap-targets` (Track B-admin's job; documented here
 * so the contract is stable).
 */
export interface TapTargetEntry {
  /** For phones: device UUID. For chargers: chargeBoxId. */
  deviceId: string;
  pairableType: "device" | "charger";
  kind: "charger" | "phone_nfc" | "tablet_nfc" | "laptop_nfc";
  /**
   * Always-displayable label. For chargers this is
   * `COALESCE(friendly_name, charge_box_id)`; for devices it's
   * `devices.label`. The picker should prefer `friendlyName` for
   * heading display (so unnamed targets render with a kind-prefixed
   * fallback rather than the raw ID), and use `label` only when a
   * single string is needed.
   */
  label: string;
  /**
   * Admin-set human name. `null` when the row has no friendly name
   * and the picker should fall back to a generic display like
   * "Charger {short id}" / "iPhone" / "Laptop". Distinguishing
   * this from `label` lets the UI avoid surfacing the raw ID as
   * the visible name when no human-readable name exists.
   */
  friendlyName: string | null;
  capabilities: DeviceCapability[];
  isOnline: boolean;
  /** Hint to the frontend picker for grouping ("My phone" vs "Other"). */
  isOwnDevice?: boolean;
}

/**
 * Returned by `POST /api/devices/scan-result` (and the polling fallback).
 * Strictly minimum-viable PII; see `60-security.md` §10 for the rationale.
 */
export interface EnrichedScanResult {
  ok: true;
  found: boolean;
  pairingCode: string;
  /** Hex uppercase. Always normalized server-side. */
  idTag: string;
  resolvedAtIso: string;
  tag: {
    displayName: string | null;
    /** "ev_card" | "phone_nfc" | etc. — matches `TAG_TYPES`. */
    tagType: string;
  } | null;
  customer: {
    /** First non-null of: customerName, slug, externalId. */
    displayName: string | null;
    slug: string | null;
  } | null;
  subscription: {
    /** First non-null of: subscriptionName, planCode. */
    planLabel: string | null;
    status: "active" | "pending" | "terminated" | "canceled" | null;
    currentPeriodEndIso: string | null;
    billingTier: "standard" | "comped" | null;
  } | null;
}

/**
 * Body of the `device.scan.requested` event (and APNs payload).
 * Sent to the device's SSE stream + push channel when an admin or owner
 * arms a scan.
 */
export interface DeviceScanRequestedPayload {
  deviceId: string;
  pairingCode: string;
  purpose: ScanPurpose;
  expiresAtIso: string;
  expiresAtEpochMs: number;
  /** null = system-initiated (e.g. owner self-arm via app). */
  requestedByUserId: string | null;
  /** Free-text shown in the app's prompt — e.g. "Front desk". */
  hintLabel: string | null;
}

/**
 * Body of the `device.scan.completed` event. Fired by `scan-result` and
 * `scan-arm` cancel paths. Used by the admin SSE stream + audit hooks.
 */
export interface DeviceScanCompletedPayload {
  deviceId: string;
  pairingCode: string;
  /** Hex uppercase id-tag the device reported. */
  idTag: string;
  /** ms since epoch. */
  t: number;
  success: boolean;
}

/**
 * Body of the `device.scan.cancelled` event. Fired when an in-flight
 * scan-arm intent is dropped by either side before a tag is read.
 *
 * Sources:
 *   - `"admin"` — admin invoked DELETE `/api/admin/devices/{id}/scan-arm`,
 *     i.e. closed the unified `<ScanModal>`.
 *   - `"device"` — iOS app POSTed `/api/devices/scan-cancel` after the
 *     user dismissed the active-scan screen.
 *   - `"customer"` — a customer dismissed an in-flight remote-login scan
 *     they initiated against an admin's online phone via
 *     `DELETE /api/auth/scan-pair` (pairableType=device path).
 *
 * Both sides (admin SSE stream + device SSE stream) consume this event
 * so cancellation propagates bidirectionally — matching the live-status
 * contract documented in `30-backend.md` § "Scan-arm bidirectional sync".
 */
export interface DeviceScanCancelledPayload {
  deviceId: string;
  pairingCode: string;
  /** ms since epoch. */
  cancelledAt: number;
  source: "admin" | "device" | "customer";
}

/**
 * Body of the `device.session.replaced` event. Fired when a second SSE
 * stream connects for the same device — the old stream receives this and
 * closes.
 */
export interface DeviceSessionReplacedPayload {
  deviceId: string;
  /** ms since epoch. */
  replacedAt: number;
}

/**
 * Body of the `device.token.revoked` event. Fired when a token row is
 * revoked (admin force-revoke, self-deregister, or expiry). The matching
 * SSE stream closes and the device app falls back to the welcome screen.
 */
export interface DeviceTokenRevokedPayload {
  deviceId: string;
  tokenId: string;
  /** Free-form reason ("admin", "self", "expiry", etc.). */
  reason?: string;
}

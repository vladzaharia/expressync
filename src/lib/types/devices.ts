/**
 * ExpresScan / Wave 1 Track A — shared device types.
 *
 * Single source of truth for cross-track contracts. Mirrored as Swift
 * `Codable` structs in `expresscan/Sources/Models/`. Changes here require
 * sign-off from all three implementation tracks (backend, frontend, iOS).
 *
 * See `expresscan/docs/plan/20-contracts.md` for the canonical spec.
 */

/** Form-factor of a registered NFC reader device. */
export const DEVICE_KINDS = ["phone_nfc", "laptop_nfc"] as const;
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
 * never includes `pushToken`, raw bearer, or `secret_hash`.
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
  kind: "charger" | "phone_nfc" | "laptop_nfc";
  label: string;
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

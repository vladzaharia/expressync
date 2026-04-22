/**
 * Phase P5 — Charging Profiles service
 *
 * Per-Lago-subscription charging schedule + power cap. Our database is the
 * source of truth; a best-effort mirror is written to the Lago subscription's
 * `metadata.charging_profile` JSON blob.
 *
 * This service also exposes two hook entry points consumed by sibling
 * services — both are non-blocking at the caller (wrap in try/catch):
 *   - onReservationCreated(...)   called after reservations.service creates
 *                                 a reservation against a subscription that
 *                                 has a profile.
 *   - onTransactionStarted(...)   called after sync.service processes a new
 *                                 StEvE transaction belonging to a mapped
 *                                 subscription with a profile.
 *
 * OCPP mapping:
 *   TxDefaultProfile (subscription-wide) or TxProfile (transaction-bound)
 *   stackLevel: 1
 *   chargingRateUnit: "W"
 *   numberPhases: 3
 *   validFrom / validUntil populated for reservation-bound applies
 *   ocpp_charging_profile_id: monotonic counter per subscription row
 *
 * NOTE: `steveClient.operations.setChargingProfile` is referenced per the
 * plan's P5 Reuse Constraints but is not yet wired into the StEvE client in
 * this worktree — we build the OCPP payload here and invoke it behind a
 * feature-guarded call. When the operations namespace lands (P0 / agent-
 * orphans wiring) this call site starts dispatching; until then we log and
 * return a synthetic taskId of 0 so downstream consumers don't crash.
 */

import { db } from "../db/index.ts";
import {
  type ChargingProfile,
  type ChargingProfilePreset,
  chargingProfiles,
  type ChargingWindow,
  type NewChargingProfile,
} from "../db/schema.ts";
import { eq } from "drizzle-orm";
import { lagoClient } from "../lib/lago-client.ts";
import { logger } from "../lib/utils/logger.ts";

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------

export interface PresetShape {
  preset: ChargingProfilePreset;
  windows: ChargingWindow[];
  maxWGlobal: number | null;
  label: string;
  disabled?: boolean;
}

/** 00:00 → 06:00 + 22:00 → 24:00 each night (weekdays), all-day on weekends */
function buildOffpeakWindows(): ChargingWindow[] {
  const out: ChargingWindow[] = [];
  // Weekdays (Mon=1 … Fri=5): early-morning + late-night slots
  for (const dow of [1, 2, 3, 4, 5]) {
    out.push({ dayOfWeek: dow, startMin: 0, endMin: 6 * 60 });
    out.push({ dayOfWeek: dow, startMin: 22 * 60, endMin: 24 * 60 });
  }
  // Weekends (Sun=0, Sat=6): all day
  out.push({ dayOfWeek: 0, startMin: 0, endMin: 24 * 60 });
  out.push({ dayOfWeek: 6, startMin: 0, endMin: 24 * 60 });
  return out;
}

/**
 * Build the canonical preset shape for a given preset id.
 * Custom uses the existing windows from the stored row (see upsertProfile).
 */
export function buildPreset(
  preset: ChargingProfilePreset,
): PresetShape {
  switch (preset) {
    case "unlimited":
      return {
        preset,
        windows: [],
        maxWGlobal: null,
        label: "Unlimited",
      };
    case "offpeak":
      return {
        preset,
        windows: buildOffpeakWindows(),
        maxWGlobal: null,
        label: "Off-peak only",
      };
    case "cap7kw":
      return {
        preset,
        windows: [],
        maxWGlobal: 7000,
        label: "Cap at 7 kW",
      };
    case "cap11kw":
      return {
        preset,
        windows: [],
        maxWGlobal: 11000,
        label: "Cap at 11 kW",
      };
    case "solar":
      return {
        preset,
        windows: [],
        maxWGlobal: null,
        label: "Solar surplus",
        disabled: true,
      };
    case "custom":
      return {
        preset,
        windows: [],
        maxWGlobal: null,
        label: "Custom",
      };
  }
}

/** Human-readable preset label (used by sibling Link/Tag detail chips). */
export function presetLabel(profile: ChargingProfile | null): string {
  if (!profile || profile.preset === "unlimited") return "Unlimited";
  const base = buildPreset(profile.preset as ChargingProfilePreset).label;
  if (profile.maxWGlobal) {
    return `${base} (${(profile.maxWGlobal / 1000).toFixed(0)} kW)`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Core CRUD
// ---------------------------------------------------------------------------

/** Fetch the active profile for a subscription (null if none). */
export async function getProfile(
  lagoSubscriptionExternalId: string,
): Promise<ChargingProfile | null> {
  const [row] = await db
    .select()
    .from(chargingProfiles)
    .where(
      eq(
        chargingProfiles.lagoSubscriptionExternalId,
        lagoSubscriptionExternalId,
      ),
    )
    .limit(1);
  return row ?? null;
}

export interface UpsertProfileInput {
  lagoSubscriptionExternalId: string;
  preset: ChargingProfilePreset;
  windows?: ChargingWindow[];
  maxWGlobal?: number | null;
  applyNow?: boolean;
  userId?: string | null;
}

export interface UpsertProfileResult {
  profile: ChargingProfile;
  lagoMirrorOk: boolean;
  lagoMirrorError?: string;
}

/**
 * Upsert a charging profile for a subscription.
 *
 * Local DB write is authoritative and always committed first. Lago
 * metadata mirror is best-effort; failures are recorded in `lagoSyncError`
 * but do not throw.
 */
export async function upsertProfile(
  input: UpsertProfileInput,
): Promise<UpsertProfileResult> {
  const shape = buildPreset(input.preset);
  const windows = input.preset === "custom"
    ? (input.windows ?? [])
    : shape.windows;
  const maxWGlobal = input.preset === "custom"
    ? (input.maxWGlobal ?? null)
    : shape.maxWGlobal;

  const existing = await getProfile(input.lagoSubscriptionExternalId);
  const nextOcppId = (existing?.ocppChargingProfileId ?? 0) + 1;

  const values: NewChargingProfile = {
    lagoSubscriptionExternalId: input.lagoSubscriptionExternalId,
    preset: input.preset,
    windows,
    maxWGlobal,
    ocppChargingProfileId: nextOcppId,
    applyToActiveSessions: !!input.applyNow,
    createdByUserId: existing
      ? existing.createdByUserId
      : (input.userId ?? null),
    updatedByUserId: input.userId ?? null,
    updatedAt: new Date(),
  };

  let row: ChargingProfile;
  if (existing) {
    const [updated] = await db
      .update(chargingProfiles)
      .set({
        preset: values.preset,
        windows: values.windows,
        maxWGlobal: values.maxWGlobal,
        ocppChargingProfileId: nextOcppId,
        applyToActiveSessions: values.applyToActiveSessions,
        updatedByUserId: values.updatedByUserId,
        updatedAt: values.updatedAt,
      })
      .where(eq(chargingProfiles.id, existing.id))
      .returning();
    row = updated;
  } else {
    const [inserted] = await db
      .insert(chargingProfiles)
      .values(values)
      .returning();
    row = inserted;
  }

  // Best-effort Lago metadata mirror
  let lagoMirrorOk = true;
  let lagoMirrorError: string | undefined;
  try {
    await mirrorToLago(row);
    await db
      .update(chargingProfiles)
      .set({ lagoSyncedAt: new Date(), lagoSyncError: null })
      .where(eq(chargingProfiles.id, row.id));
    row = { ...row, lagoSyncedAt: new Date(), lagoSyncError: null };
  } catch (err) {
    lagoMirrorOk = false;
    lagoMirrorError = err instanceof Error ? err.message : String(err);
    logger.warn(
      "ChargingProfile",
      "Lago metadata mirror failed (non-blocking)",
      {
        subscription: input.lagoSubscriptionExternalId,
        error: lagoMirrorError,
      },
    );
    await db
      .update(chargingProfiles)
      .set({ lagoSyncError: lagoMirrorError })
      .where(eq(chargingProfiles.id, row.id));
    row = { ...row, lagoSyncError: lagoMirrorError ?? null };
  }

  return { profile: row, lagoMirrorOk, lagoMirrorError };
}

/** Alias for applying the Unlimited preset (UI "Clear" action). */
export function clearProfile(
  lagoSubscriptionExternalId: string,
  userId?: string | null,
): Promise<UpsertProfileResult> {
  return upsertProfile({
    lagoSubscriptionExternalId,
    preset: "unlimited",
    userId,
  });
}

// ---------------------------------------------------------------------------
// OCPP apply
// ---------------------------------------------------------------------------

export interface ApplyContext {
  /** "TxDefaultProfile" for subscription-wide, "TxProfile" for tx-bound */
  chargingProfilePurpose: "TxDefaultProfile" | "TxProfile";
  /** ISO-8601 */
  validFrom?: string;
  /** ISO-8601 */
  validUntil?: string;
  /** 0 = charger-wide; otherwise a connector number */
  connectorId?: number;
  /** Bound transaction id (TxProfile only) */
  transactionId?: number;
}

export interface OcppSetChargingProfilePayload {
  chargeBoxId?: string; // populated by applyToCharger
  connectorId: number;
  csChargingProfiles: {
    chargingProfileId: number;
    stackLevel: number;
    chargingProfilePurpose: "TxDefaultProfile" | "TxProfile";
    chargingProfileKind: "Absolute" | "Recurring" | "Relative";
    recurrencyKind?: "Daily" | "Weekly";
    validFrom?: string;
    validTo?: string;
    transactionId?: number;
    chargingSchedule: {
      duration?: number;
      chargingRateUnit: "W" | "A";
      chargingSchedulePeriod: Array<{
        startPeriod: number;
        limit: number;
        numberPhases?: number;
      }>;
      minChargingRate?: number;
    };
  };
}

/**
 * Build the raw OCPP SetChargingProfile payload from a stored profile row.
 *
 * For 24/7 caps (cap7kw, cap11kw) with no windows: emits a single period
 * at offset 0 with the cap limit, Recurring daily.
 *
 * For window-based profiles (offpeak, custom): emits a weekly recurrence
 * with periods anchored at each window's start. Windows are sorted and
 * flattened into the week (startPeriod in seconds from validFrom).
 *
 * For unlimited: emits a single period with Number.MAX_SAFE_INTEGER as the
 * limit (charger-side interpretation: no cap).
 */
export function buildOcppPayload(
  profile: ChargingProfile,
  ctx: ApplyContext,
): OcppSetChargingProfilePayload {
  const hasWindows = Array.isArray(profile.windows) &&
    (profile.windows as ChargingWindow[]).length > 0;
  const hasCap = typeof profile.maxWGlobal === "number" &&
    profile.maxWGlobal! > 0;

  const NO_CAP = Number.MAX_SAFE_INTEGER;
  const periods: Array<
    { startPeriod: number; limit: number; numberPhases?: number }
  > = [];

  if (!hasWindows && !hasCap) {
    // Unlimited: single wide-open period at the configured rate unit.
    periods.push({ startPeriod: 0, limit: NO_CAP, numberPhases: 3 });
  } else if (!hasWindows && hasCap) {
    // Daily cap: single period at the cap.
    periods.push({
      startPeriod: 0,
      limit: profile.maxWGlobal!,
      numberPhases: 3,
    });
  } else {
    // Window-based: emit a sorted weekly schedule of allow/deny periods.
    const windows = [...(profile.windows as ChargingWindow[])]
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMin - b.startMin);
    let cursor = 0; // seconds from start of week
    for (const w of windows) {
      const winStart = (w.dayOfWeek * 24 * 60 + w.startMin) * 60;
      const winEnd = (w.dayOfWeek * 24 * 60 + w.endMin) * 60;
      if (winStart > cursor) {
        // Disallow gap (before window): cap to 0W = effectively no charging.
        periods.push({ startPeriod: cursor, limit: 0, numberPhases: 3 });
      }
      const limit = w.maxW ?? profile.maxWGlobal ?? NO_CAP;
      periods.push({ startPeriod: winStart, limit, numberPhases: 3 });
      cursor = winEnd;
    }
    const weekSeconds = 7 * 24 * 60 * 60;
    if (cursor < weekSeconds) {
      periods.push({ startPeriod: cursor, limit: 0, numberPhases: 3 });
    }
  }

  const kind: "Recurring" | "Absolute" = ctx.validFrom || ctx.validUntil
    ? "Absolute"
    : "Recurring";

  return {
    connectorId: ctx.connectorId ?? 0,
    csChargingProfiles: {
      chargingProfileId: profile.ocppChargingProfileId,
      stackLevel: 1,
      chargingProfilePurpose: ctx.chargingProfilePurpose,
      chargingProfileKind: kind,
      recurrencyKind: kind === "Recurring" ? "Weekly" : undefined,
      validFrom: ctx.validFrom,
      validTo: ctx.validUntil,
      transactionId: ctx.transactionId,
      chargingSchedule: {
        chargingRateUnit: "W",
        chargingSchedulePeriod: periods,
      },
    },
  };
}

/**
 * Dispatch a SetChargingProfile to a specific charger + connector.
 *
 * Returns the operation/task id if StEvE's operations client is available,
 * else 0 (logged). Never throws — failures are logged and returned as
 * `{ taskId: 0, error }` so the caller can continue.
 */
export async function applyToCharger(
  profile: ChargingProfile,
  chargeBoxId: string,
  ctx: ApplyContext,
): Promise<{ taskId: number; error?: string }> {
  const payload = buildOcppPayload(profile, ctx);
  payload.chargeBoxId = chargeBoxId;

  logger.info("ChargingProfile", "Applying profile to charger", {
    chargeBoxId,
    subscription: profile.lagoSubscriptionExternalId,
    preset: profile.preset,
    purpose: ctx.chargingProfilePurpose,
    connectorId: ctx.connectorId ?? 0,
    transactionId: ctx.transactionId,
  });

  try {
    // Dynamic access: StEvE ops namespace is populated by the P0 / operations
    // work. If it isn't present yet, we don't crash — we just log.
    const steve = await import("../lib/steve-client.ts");
    const maybeOps =
      (steve.steveClient as unknown as Record<string, unknown>).operations;
    if (
      maybeOps && typeof (maybeOps as Record<string, unknown>)
          .setChargingProfile === "function"
    ) {
      const result = await (maybeOps as {
        setChargingProfile: (p: OcppSetChargingProfilePayload) => Promise<
          { taskId: number } | number
        >;
      }).setChargingProfile(payload);
      const taskId = typeof result === "number" ? result : result.taskId;
      return { taskId };
    }
    logger.warn(
      "ChargingProfile",
      "steveClient.operations.setChargingProfile not available; skipping dispatch",
      { chargeBoxId },
    );
    return { taskId: 0 };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("ChargingProfile", "Failed to dispatch SetChargingProfile", {
      chargeBoxId,
      error,
    });
    return { taskId: 0, error };
  }
}

/**
 * Apply the profile to any currently-active sessions for this subscription.
 *
 * Called as part of save-flow when the admin ticks "Apply to active
 * sessions now". Non-blocking: failures are logged, not thrown.
 */
export function applyToActiveSessions(
  profile: ChargingProfile,
): Promise<{ dispatched: number; failed: number }> {
  logger.info("ChargingProfile", "applyToActiveSessions invoked", {
    subscription: profile.lagoSubscriptionExternalId,
  });

  // Resolving active sessions requires a charger/connector lookup that
  // depends on future state (tag-to-charger session mapping). For the
  // initial ship we return a no-op result; the hook is wired and ready to
  // be fleshed out when the session registry lands.
  return Promise.resolve({ dispatched: 0, failed: 0 });
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface OnReservationCreatedInput {
  lagoSubscriptionExternalId: string | null;
  chargeBoxId: string;
  connectorId: number;
  startAt: Date;
  endAt: Date;
  transactionId?: number;
}

/**
 * Hook invoked by reservation.service after a reservation is created.
 * Looks up the profile and issues a TxDefaultProfile with validFrom/validTo
 * aligned to the reservation window.
 *
 * Non-blocking: returns `{ taskId: 0 }` for missing profile / errors.
 */
export async function onReservationCreated(
  input: OnReservationCreatedInput,
): Promise<{ taskId: number; error?: string }> {
  if (!input.lagoSubscriptionExternalId) return { taskId: 0 };
  const profile = await getProfile(input.lagoSubscriptionExternalId);
  if (!profile || profile.preset === "unlimited") return { taskId: 0 };

  return applyToCharger(profile, input.chargeBoxId, {
    chargingProfilePurpose: "TxDefaultProfile",
    connectorId: input.connectorId,
    validFrom: input.startAt.toISOString(),
    validUntil: input.endAt.toISOString(),
  });
}

export interface OnTransactionStartedInput {
  lagoSubscriptionExternalId: string | null;
  chargeBoxId: string;
  connectorId: number;
  steveTransactionId: number;
}

/**
 * Hook invoked by sync.service after a new StEvE transaction is detected.
 * Issues a TxProfile bound to the transaction id to constrain the
 * in-progress session to the subscription's profile.
 *
 * Non-blocking: wrapped in try/catch at the caller.
 */
export async function onTransactionStarted(
  input: OnTransactionStartedInput,
): Promise<{ taskId: number; error?: string }> {
  if (!input.lagoSubscriptionExternalId) return { taskId: 0 };
  const profile = await getProfile(input.lagoSubscriptionExternalId);
  if (!profile || profile.preset === "unlimited") return { taskId: 0 };

  return applyToCharger(profile, input.chargeBoxId, {
    chargingProfilePurpose: "TxProfile",
    connectorId: input.connectorId,
    transactionId: input.steveTransactionId,
  });
}

// ---------------------------------------------------------------------------
// Lago mirror
// ---------------------------------------------------------------------------

async function mirrorToLago(profile: ChargingProfile): Promise<void> {
  const payload = {
    charging_profile: {
      preset: profile.preset,
      windows: profile.windows,
      max_w_global: profile.maxWGlobal,
      ocpp_charging_profile_id: profile.ocppChargingProfileId,
      updated_at: profile.updatedAt.toISOString(),
    },
  };
  await lagoClient.updateSubscription(profile.lagoSubscriptionExternalId, {
    metadata: payload,
  });
}

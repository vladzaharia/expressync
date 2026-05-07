#!/usr/bin/env -S deno run -A
/**
 * sync-lago-charging-entitlements.ts
 *
 * Idempotent sync of the EV charging feature + per-plan entitlements in Lago.
 * Lago entitlements are how we attach `max_amps` and `ramped_charge` to plans
 * so downstream charging code (and the iPhone scan-result UI) can read them
 * without re-implementing plan-tier policy in our codebase.
 *
 * What it does:
 *   1. Ensures the `ev` feature exists with two privileges:
 *        - `max_amps`        (integer)
 *        - `ramped_charge`   (boolean)
 *   2. Sets the plan-level entitlement values per the table below.
 *   3. Re-fetches each plan and prints the effective values.
 *
 * Plan policy (matches product spec):
 *   - ExpressCharge      → max_amps=48, ramped_charge=false
 *   - ExpressChargeAC    → max_amps=48, ramped_charge=false
 *   - ExpressCharge+     → max_amps=48, ramped_charge=true
 *   - ExpressChargeM     → max_amps=24, ramped_charge=false
 *
 * Subscription overrides: this script does NOT touch subscription-level
 * overrides. Every subscription should inherit from its plan unless an admin
 * deliberately sets an override (a future per-customer cap, say). If you find
 * stray overrides matching the plan value, drop them via
 * `lagoClient.deleteSubscriptionPrivilegeOverride`.
 *
 * Usage:
 *   deno run -A scripts/sync-lago-charging-entitlements.ts
 */

import { lagoClient } from "../src/lib/lago-client.ts";
import {
  derivePlanChargingEntitlements,
  EV_FEATURE_CODE,
  EV_PRIVILEGE_MAX_AMPS,
  EV_PRIVILEGE_RAMPED_CHARGE,
} from "../src/lib/types/lago.ts";
import { config } from "../src/lib/config.ts";

interface PlanPolicy {
  code: string;
  maxAmps: number;
  rampedCharge: boolean;
}

const POLICY: ReadonlyArray<PlanPolicy> = [
  { code: "ExpressCharge", maxAmps: 48, rampedCharge: false },
  { code: "ExpressChargeAC", maxAmps: 48, rampedCharge: false },
  { code: "ExpressCharge+", maxAmps: 48, rampedCharge: true },
  { code: "ExpressChargeM", maxAmps: 24, rampedCharge: false },
];

const FEATURE_PAYLOAD = {
  code: EV_FEATURE_CODE,
  name: "EV Charging",
  description: "Access to EV charging",
  privileges: [
    {
      code: EV_PRIVILEGE_MAX_AMPS,
      name: "Max Amperage",
      value_type: "integer",
    },
    {
      code: EV_PRIVILEGE_RAMPED_CHARGE,
      name: "Ramped Charge",
      value_type: "boolean",
    },
  ],
};

async function lagoFetch(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${config.LAGO_API_URL}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${config.LAGO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Lago ${method} ${path} → ${res.status}: ${text}`);
  }
  if (res.status === 204 || res.status === 404) return null;
  return await res.json();
}

async function ensureFeature(): Promise<void> {
  // Lago doesn't have an upsert; try GET, then PUT (update) if it exists, else POST (create).
  const existing = await lagoFetch(
    "GET",
    `/api/v1/features/${encodeURIComponent(EV_FEATURE_CODE)}`,
  ) as { feature?: unknown } | null;

  if (existing?.feature) {
    await lagoFetch(
      "PUT",
      `/api/v1/features/${encodeURIComponent(EV_FEATURE_CODE)}`,
      { feature: FEATURE_PAYLOAD },
    );
    console.log(`[feature] updated '${EV_FEATURE_CODE}'`);
  } else {
    await lagoFetch("POST", `/api/v1/features`, { feature: FEATURE_PAYLOAD });
    console.log(`[feature] created '${EV_FEATURE_CODE}'`);
  }
}

async function syncPlan(p: PlanPolicy): Promise<void> {
  await lagoClient.setPlanEntitlements(p.code, {
    [EV_FEATURE_CODE]: {
      [EV_PRIVILEGE_MAX_AMPS]: p.maxAmps,
      [EV_PRIVILEGE_RAMPED_CHARGE]: p.rampedCharge,
    },
  });

  const plan = await lagoClient.getPlan(p.code);
  const eff = derivePlanChargingEntitlements(plan);
  const ok = eff.maxAmps === p.maxAmps && eff.rampedCharge === p.rampedCharge;
  const status = ok ? "OK" : "MISMATCH";
  console.log(
    `[plan] ${
      p.code.padEnd(20)
    } max_amps=${eff.maxAmps} ramped_charge=${eff.rampedCharge} (${status})`,
  );
  if (!ok) {
    throw new Error(
      `Effective entitlements diverged for ${p.code}: expected max_amps=${p.maxAmps}, ramped_charge=${p.rampedCharge}`,
    );
  }
}

async function main(): Promise<void> {
  await ensureFeature();
  for (const p of POLICY) {
    await syncPlan(p);
  }
  console.log("done.");
}

if (import.meta.main) {
  await main();
}

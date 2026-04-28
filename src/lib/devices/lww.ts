/**
 * ExpresScan v2 / Wave 6 Slice B — per-key Last-Writer-Wins merge for
 * `device_settings`.
 *
 * Pure-logic helpers used by the upcoming `POST /api/devices/me/state/sync`
 * endpoint (slice C). Kept here in a stand-alone module so the iOS-side
 * Swift port (`Sources/DeviceSync/SettingsReconciler.swift`, slice E)
 * can mirror the algorithm verbatim against the same fixtures.
 *
 * ## Algorithm
 *
 * Settings are a flat key-value map persisted per-device. Both sides
 * (server + client) keep an `updatedAt` timestamp + `updatedBy` actor
 * tag per key. On sync:
 *
 *   - The client sends `SettingDelta[]` — only keys it has touched
 *     since the last sync. Each carries `{ key, value, clientUpdatedAt }`.
 *   - The server replies with the post-merge `SettingRow[]` for the
 *     full set, so the client can replace its local map atomically
 *     (no partial-state windows).
 *   - Per key, the surviving row is the one with `max(updatedAt)`.
 *   - **Tie-breaks: server wins.** Equal timestamps keep the existing
 *     server value rather than applying the incoming client delta. This
 *     guarantees idempotence on retried syncs (same delta replayed
 *     can't undo a later server-side admin save that happened to land
 *     at the same wall-clock millisecond).
 *
 * ## Clock-skew defense
 *
 * Clients can lie about `clientUpdatedAt` (deliberately or via a busted
 * RTC). A future-stamp would dominate every subsequent merge until the
 * server caught up — a poisoning attack. `clampClientUpdatedAt` clamps
 * the incoming timestamp to `min(clientTs, now + 5_000ms)`. Five seconds
 * of forward slack absorbs benign clock skew without leaving room for
 * meaningful poisoning. Negative skew (client clock behind server) is
 * fine — older timestamps simply lose the LWW race against newer
 * server values, which is the correct outcome.
 */

/** A row as persisted in `device_settings` (post-merge, server-canonical). */
export interface SettingRow {
  key: string;
  value: unknown;
  updatedAt: Date;
  updatedBy: string;
}

/**
 * A delta sent from the client. `clientUpdatedAt` is what the client
 * *claims* the timestamp is — the merge caller is expected to have
 * already passed it through `clampClientUpdatedAt`.
 */
export interface SettingDelta {
  key: string;
  value: unknown;
  clientUpdatedAt: Date;
  /** Stable client identifier (e.g. `device:{id}`). */
  updatedBy: string;
}

/**
 * Clamp a client-supplied timestamp to defeat future-stamp poisoning.
 *
 * Returns `min(clientTs, now + 5_000ms)`. The 5-second forward slack
 * absorbs benign clock skew (NTP drift, RTC jitter on first boot)
 * without giving an attacker meaningful room to pin a delta into the
 * future.
 *
 * Past-stamps are passed through unchanged — an old timestamp simply
 * loses the LWW race, which is the correct outcome.
 */
export function clampClientUpdatedAt(clientTs: Date, now: Date): Date {
  const ceiling = new Date(now.getTime() + 5_000);
  if (clientTs.getTime() > ceiling.getTime()) return ceiling;
  return clientTs;
}

/**
 * Merge per-key LWW. Returns the post-merge row set.
 *
 * For each key:
 *   - Both sides present → keep `max(updatedAt)`. On tie, server wins.
 *   - Only one side present → keep that one.
 *
 * The output is keyed-unique and ordered by `key` ascending so equal
 * inputs always produce identical outputs (helpful for snapshot
 * fixtures shared with the Swift port).
 */
export function mergeSettings(
  local: SettingDelta[],
  remote: SettingRow[],
): SettingRow[] {
  const merged = new Map<string, SettingRow>();

  // Seed with server-canonical rows first.
  for (const r of remote) {
    merged.set(r.key, {
      key: r.key,
      value: r.value,
      updatedAt: new Date(r.updatedAt.getTime()),
      updatedBy: r.updatedBy,
    });
  }

  // Apply client deltas only where they strictly beat the server stamp.
  // Tie → server wins (the existing entry stays).
  for (const d of local) {
    const existing = merged.get(d.key);
    const candidate: SettingRow = {
      key: d.key,
      value: d.value,
      updatedAt: new Date(d.clientUpdatedAt.getTime()),
      updatedBy: d.updatedBy,
    };
    if (!existing) {
      merged.set(d.key, candidate);
      continue;
    }
    if (candidate.updatedAt.getTime() > existing.updatedAt.getTime()) {
      merged.set(d.key, candidate);
    }
    // else: equal-or-older → keep existing (server-wins on tie).
  }

  return Array.from(merged.values()).sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  );
}

/**
 * ExpresScan v2 / Wave 6 Slice B — LWW merge unit tests.
 *
 * Pure-logic tests. Importing `lww.ts` does not pull any DB / network
 * deps, so we leave the resource sanitizers on by default.
 *
 * The fixtures here are mirrored verbatim into the iOS-side
 * `Tests/DeviceSync/SettingsReconcilerTests.swift` (slice E) so a
 * divergent merge implementation between server and client is caught
 * by either suite.
 */

import { assertEquals } from "@std/assert";
import {
  clampClientUpdatedAt,
  mergeSettings,
  type SettingDelta,
  type SettingRow,
} from "./lww.ts";

const T0 = new Date("2026-01-01T00:00:00.000Z");
const T1 = new Date("2026-01-01T00:00:01.000Z");
const T2 = new Date("2026-01-01T00:00:02.000Z");

function row(
  key: string,
  value: unknown,
  updatedAt: Date,
  updatedBy = "server",
): SettingRow {
  return { key, value, updatedAt, updatedBy };
}

function delta(
  key: string,
  value: unknown,
  clientUpdatedAt: Date,
  updatedBy = "device:1",
): SettingDelta {
  return { key, value, clientUpdatedAt, updatedBy };
}

// ---------------------------------------------------------------------------
// mergeSettings
// ---------------------------------------------------------------------------

Deno.test("mergeSettings — older client → server wins", () => {
  const local = [delta("device.label", "phone-A", T0)];
  const remote = [row("device.label", "phone-B", T1)];
  const merged = mergeSettings(local, remote);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].value, "phone-B");
  assertEquals(merged[0].updatedAt.toISOString(), T1.toISOString());
  assertEquals(merged[0].updatedBy, "server");
});

Deno.test("mergeSettings — newer client → client wins", () => {
  const local = [delta("device.label", "phone-A", T2)];
  const remote = [row("device.label", "phone-B", T1)];
  const merged = mergeSettings(local, remote);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].value, "phone-A");
  assertEquals(merged[0].updatedAt.toISOString(), T2.toISOString());
  assertEquals(merged[0].updatedBy, "device:1");
});

Deno.test("mergeSettings — equal timestamps → server wins (tie-break)", () => {
  const local = [delta("device.label", "phone-A", T1)];
  const remote = [row("device.label", "phone-B", T1)];
  const merged = mergeSettings(local, remote);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].value, "phone-B");
  assertEquals(merged[0].updatedBy, "server");
});

Deno.test("mergeSettings — client-only key flows through", () => {
  const local = [delta("notifications.scanRequest", false, T1)];
  const remote: SettingRow[] = [];
  const merged = mergeSettings(local, remote);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].key, "notifications.scanRequest");
  assertEquals(merged[0].value, false);
  assertEquals(merged[0].updatedBy, "device:1");
});

Deno.test("mergeSettings — server-only key flows through", () => {
  const local: SettingDelta[] = [];
  const remote = [row("device.label", "kiosk-A", T1)];
  const merged = mergeSettings(local, remote);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].value, "kiosk-A");
});

Deno.test("mergeSettings — multi-key merge applies LWW per key", () => {
  const local = [
    delta("device.label", "phone-A", T2), // newer than server
    delta("notifications.scanRequest", true, T0), // older than server
  ];
  const remote = [
    row("device.label", "phone-B", T1),
    row("notifications.scanRequest", false, T1),
  ];
  const merged = mergeSettings(local, remote);
  assertEquals(merged.length, 2);
  // sorted by key ascending
  assertEquals(merged[0].key, "device.label");
  assertEquals(merged[0].value, "phone-A");
  assertEquals(merged[1].key, "notifications.scanRequest");
  assertEquals(merged[1].value, false); // server wins (client older)
});

Deno.test("mergeSettings — output is sorted by key (deterministic)", () => {
  const local = [delta("z.last", 1, T1), delta("a.first", 2, T1)];
  const remote: SettingRow[] = [row("m.middle", 3, T0)];
  const merged = mergeSettings(local, remote);
  assertEquals(merged.map((m) => m.key), ["a.first", "m.middle", "z.last"]);
});

Deno.test("mergeSettings — does not mutate inputs", () => {
  const localOriginal = [delta("k", "v", T0)];
  const remoteOriginal = [row("k", "v2", T1)];
  const localCopy = JSON.parse(JSON.stringify(localOriginal));
  const remoteCopy = JSON.parse(JSON.stringify(remoteOriginal));
  mergeSettings(localOriginal, remoteOriginal);
  assertEquals(JSON.parse(JSON.stringify(localOriginal)), localCopy);
  assertEquals(JSON.parse(JSON.stringify(remoteOriginal)), remoteCopy);
});

// ---------------------------------------------------------------------------
// clampClientUpdatedAt
// ---------------------------------------------------------------------------

Deno.test("clampClientUpdatedAt — past timestamp passes through", () => {
  const now = new Date("2026-01-01T00:00:10.000Z");
  const past = new Date("2026-01-01T00:00:00.000Z");
  const out = clampClientUpdatedAt(past, now);
  assertEquals(out.toISOString(), past.toISOString());
});

Deno.test("clampClientUpdatedAt — slightly-future (within 5s slack) passes through", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const future = new Date("2026-01-01T00:00:04.000Z"); // +4s
  const out = clampClientUpdatedAt(future, now);
  assertEquals(out.toISOString(), future.toISOString());
});

Deno.test("clampClientUpdatedAt — at the 5s slack boundary passes through", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const future = new Date("2026-01-01T00:00:05.000Z"); // +5s exactly
  const out = clampClientUpdatedAt(future, now);
  assertEquals(out.toISOString(), future.toISOString());
});

Deno.test("clampClientUpdatedAt — far-future is clamped to now+5s", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const future = new Date("2030-01-01T00:00:00.000Z"); // 4 years
  const out = clampClientUpdatedAt(future, now);
  assertEquals(out.toISOString(), "2026-01-01T00:00:05.000Z");
});

Deno.test("clampClientUpdatedAt — combined with merge defeats future-stamp poisoning", () => {
  const now = new Date("2026-01-01T00:00:10.000Z");
  // Attacker-controlled client claims a year-2030 timestamp.
  const claimed = new Date("2030-01-01T00:00:00.000Z");
  const clamped = clampClientUpdatedAt(claimed, now);
  // Server has a fresh value at T=now (a real admin save).
  const serverRow = row("device.label", "admin-set", now, "admin:42");
  const clientDelta = delta("device.label", "attacker-set", clamped);
  const merged = mergeSettings([clientDelta], [serverRow]);
  // The clamped client timestamp (now+5s) is *after* the server's `now`
  // — so without further protection, the client would still win the LWW
  // race within the 5-second slack. That is acceptable: 5s is the
  // benign-skew budget; an attacker who can control 5 seconds of
  // timestamp drift has bigger problems. What we *do* defeat is
  // year-scale poisoning where a single bad sync would dominate every
  // future merge until the server caught up. Verify the clamp brought
  // the client stamp to now+5s, not year 2030.
  assertEquals(merged[0].updatedAt.getTime(), now.getTime() + 5_000);
});

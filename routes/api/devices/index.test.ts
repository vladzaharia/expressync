/**
 * GET /api/devices — Chargers list handler-direct unit tests.
 */

import { assertEquals } from "@std/assert";
import {
  _resetChargerListTestSeams,
  _setChargerListLoaderForTests,
  handler,
  mapChargerState,
} from "./index.ts";

const URL_BASE = "https://manage.example.com/api/devices";
const DEVICE_UUID = "11111111-2222-3333-4444-555555555555";
const OWNER_USER_ID = "owner-user-1";

function deviceState(caps: string[]) {
  return {
    device: {
      id: DEVICE_UUID,
      ownerUserId: OWNER_USER_ID,
      capabilities: caps,
      secret: "x",
      tokenId: "tok",
    },
  };
}

async function callGet(state: unknown): Promise<Response> {
  const req = new Request(URL_BASE, { method: "GET" });
  // deno-lint-ignore no-explicit-any
  const get = (handler as any).GET as (ctx: {
    req: Request;
    state: unknown;
    params: Record<string, never>;
  }) => Promise<Response>;
  return await get({ req, state, params: {} });
}

function tearDown() {
  _resetChargerListTestSeams();
}

// ---------------------------------------------------------------------------
// Auth gating
// ---------------------------------------------------------------------------

Deno.test("GET /api/devices — no bearer returns 401", async () => {
  try {
    const res = await callGet({});
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error, "unauthorized");
  } finally {
    tearDown();
  }
});

Deno.test("GET /api/devices — caller without `user` cap returns 403", async () => {
  try {
    const res = await callGet(deviceState(["scanner"]));
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.error, "capability_denied");
    // missing[] echoes the capability the gate required.
    assertEquals(body.missing, ["user"]);
  } finally {
    tearDown();
  }
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

Deno.test("GET /api/devices — returns sorted charger rows", async () => {
  // Both fixtures use a fresh `last_status_at` so they fall inside the
  // 90 s online window and produce live state-enum values (rather than
  // collapsing to offline).
  const recentA = new Date(Date.now() - 30_000); // 30 s ago
  const recentB = new Date(); // now
  _setChargerListLoaderForTests(() =>
    Promise.resolve([
      {
        id: "BAY-1",
        kind: "charger",
        label: "BAY-1",
        last_seen_at: recentA,
        last_status_at: recentA,
        last_status: "Available",
        friendly_name: "Bay 1",
        form_factor: "wallbox",
        connector_type_override: null,
        max_kw_override: null,
        management_mode: "ocpp",
      },
      {
        id: "BAY-2",
        kind: "charger",
        label: "BAY-2",
        last_seen_at: recentB,
        last_status_at: recentB,
        last_status: "Charging",
        friendly_name: null,
        form_factor: "pulsar",
        connector_type_override: null,
        max_kw_override: null,
        management_mode: "ocpp",
      },
    ])
  );
  try {
    const res = await callGet(deviceState(["user"]));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.chargers.length, 2);
    // Order preserved from the loader (which is sorted DESC by last_seen_at).
    assertEquals(body.chargers[0].chargerId, "BAY-1");
    assertEquals(body.chargers[0].label, "Bay 1"); // friendly_name preferred
    assertEquals(body.chargers[0].formFactor, "wallbox");
    assertEquals(body.chargers[0].state, "idle"); // "Available" → idle
    assertEquals(body.chargers[1].chargerId, "BAY-2");
    assertEquals(body.chargers[1].label, "BAY-2"); // falls back to id
    assertEquals(body.chargers[1].formFactor, "pulsar");
    assertEquals(body.chargers[1].state, "charging");
    // siteName + connectorType + maxKw aren't tracked yet — null for now.
    assertEquals(body.chargers[0].siteName, null);
    assertEquals(body.chargers[0].connectorType, null);
    assertEquals(body.chargers[0].maxKw, null);
  } finally {
    tearDown();
  }
});

Deno.test("GET /api/devices — non-charger rows are filtered out", async () => {
  // Even if the loader (test seam) returns app-device rows, the handler
  // filters to kind='charger' as a defense against view-shape drift.
  _setChargerListLoaderForTests(() =>
    Promise.resolve([
      {
        id: DEVICE_UUID,
        kind: "phone_nfc",
        label: "Vlad's iPhone",
        last_seen_at: new Date(),
        last_status_at: null,
        last_status: null,
        friendly_name: null,
        form_factor: null,
        connector_type_override: null,
        max_kw_override: null,
        management_mode: null,
      },
      {
        id: "BAY-3",
        kind: "charger",
        label: "BAY-3",
        last_seen_at: new Date(),
        last_status_at: new Date(),
        last_status: "Available",
        friendly_name: "Bay 3",
        form_factor: "commander",
        connector_type_override: null,
        max_kw_override: null,
        management_mode: "ocpp",
      },
    ])
  );
  try {
    const res = await callGet(deviceState(["user"]));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.chargers.length, 1);
    assertEquals(body.chargers[0].chargerId, "BAY-3");
  } finally {
    tearDown();
  }
});

Deno.test("GET /api/devices — empty list returns empty array", async () => {
  _setChargerListLoaderForTests(() => Promise.resolve([]));
  try {
    const res = await callGet(deviceState(["user"]));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.chargers, []);
  } finally {
    tearDown();
  }
});

// ---------------------------------------------------------------------------
// State mapping (pure helper)
// ---------------------------------------------------------------------------

Deno.test("mapChargerState — known statuses → wire enum", () => {
  const fresh = Date.now();
  assertEquals(mapChargerState("Available", fresh, fresh), "idle");
  assertEquals(mapChargerState("Charging", fresh, fresh), "charging");
  assertEquals(mapChargerState("Reserved", fresh, fresh), "reserved");
  assertEquals(mapChargerState("Preparing", fresh, fresh), "preparing");
  assertEquals(mapChargerState("Faulted", fresh, fresh), "outOfService");
  assertEquals(mapChargerState("Unavailable", fresh, fresh), "outOfService");
  assertEquals(mapChargerState("Offline", fresh, fresh), "offline");
});

Deno.test("mapChargerState — stale timestamp collapses to offline", () => {
  const now = Date.now();
  const stale = now - (5 * 60_000); // 5 min ago, > 90s window
  assertEquals(mapChargerState("Charging", stale, now), "offline");
});

Deno.test("mapChargerState — null timestamp is offline", () => {
  assertEquals(mapChargerState("Charging", null), "offline");
});

Deno.test("mapChargerState — null status is offline", () => {
  assertEquals(mapChargerState(null, Date.now()), "offline");
});

/**
 * ExpresScan / Wave 4 Track C-e2e — handler-direct end-to-end integration test.
 *
 * Exercises the full happy path of the device scan flow:
 *
 *   1. Admin POSTs /api/admin/devices/{deviceId}/scan-arm
 *   2. (iOS sim) connects to /api/devices/scan-stream — receives `scan.requested`
 *   3. (iOS sim) computes HMAC-SHA256 nonce
 *   4. (iOS sim) POSTs /api/devices/scan-result with the signed body
 *   5. Browser modal SSE (/api/auth/scan-detect?pairingCode&deviceId)
 *      receives the same `scan.intercepted` event, identical wire shape
 *      to the legacy charger-sourced scan flow.
 *
 * This is a HANDLER-DIRECT test — no Docker, no live Postgres, no actual
 * HTTP server. The two production handlers (`scan-arm.ts` and
 * `scan-result.ts`) expose `_set*ForTests` seams for their DB / APNs
 * dependencies. SSE wiring is exercised at the event-bus layer because
 * the SSE handler itself opens a streaming response that's awkward to
 * unit-test against; the wiring is identical (same `eventBus.subscribe`
 * with the same filter logic), so verifying the bus contract is what
 * the SSE handler actually depends on.
 *
 * Coverage:
 *   - Happy path (admin-link purpose, found tag, browser modal sees event)
 *   - HMAC mismatch at scan-result → 401, no `scan.intercepted` fired
 *   - Pairing already consumed → 429, no double-fire
 *   - Pairing expired → 429
 *   - Wrong-device bearer (cross-device isolation): event filtered out
 *   - Token revocation: device.token.revoked closes the SSE stream
 *   - Replay buffer: connect with Last-Event-ID after publish, replay arrives
 *   - HMAC fixture vectors load and verify against the canonical signer
 *
 * Resource sanitization is disabled because importing the production
 * handlers pulls in the postgres pool which keeps connections alive even
 * when never queried.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  _resetScanArmTestSeams,
  _setApnsSenderForTests,
  _setArmedPairingFinderForTests,
  _setDeviceLoaderForTests,
  _setPairingDeleterForTests,
  _setPairingInserterForTests,
  handler as scanArmHandler,
} from "../../../routes/api/admin/devices/[deviceId]/scan-arm.ts";
import {
  _resetScanResultTestSeams,
  _setEnricherForTests,
  _setPairingClaimerForTests,
  _signNonceForTests,
  handler as scanResultHandler,
} from "../../../routes/api/devices/scan-result.ts";
import {
  type DeliveredEvent,
  eventBus,
} from "../../../src/services/event-bus.service.ts";

// ============================================================================
// Constants
// ============================================================================

const ADMIN_USER_ID = "admin-user-e2e";
const DEVICE_UUID = "11111111-2222-3333-4444-555555555555";
const OTHER_DEVICE_UUID = "99999999-8888-7777-6666-555555555555";
/** Canonical 32-zero-byte secret base64url-encoded; matches fixture vectors. */
const ZERO_SECRET = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const SCAN_ARM_URL =
  `https://manage.polaris.express/api/admin/devices/${DEVICE_UUID}/scan-arm`;
const SCAN_RESULT_URL =
  "https://manage.polaris.express/api/devices/scan-result";

// ============================================================================
// Types — minimal shape to satisfy the handler contexts.
// ============================================================================

interface AdminState {
  user?: {
    id: string;
    role: string;
    email: string;
    name: string | null;
    emailVerified: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
}

interface DeviceState {
  device?: {
    id: string;
    ownerUserId: string;
    capabilities: string[];
    secret: string;
    tokenId: string;
  };
}

interface FakeDevice {
  id: string;
  ownerUserId: string;
  capabilities: string[];
  pushToken: string | null;
  apnsEnvironment: "sandbox" | "production" | null;
  lastSeenAt: Date | null;
  deletedAt: Date | null;
  revokedAt: Date | null;
}

// ============================================================================
// Helpers
// ============================================================================

function adminState(): AdminState {
  return {
    user: {
      id: ADMIN_USER_ID,
      role: "admin",
      email: "admin@example.com",
      name: "Admin",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

function makeOnlineDevice(over: Partial<FakeDevice> = {}): FakeDevice {
  return {
    id: DEVICE_UUID,
    ownerUserId: ADMIN_USER_ID,
    capabilities: ["tap"],
    pushToken: null,
    apnsEnvironment: null,
    lastSeenAt: new Date(Date.now() - 5_000),
    deletedAt: null,
    revokedAt: null,
    ...over,
  };
}

function deviceState(deviceId: string, secret: string): DeviceState {
  return {
    device: {
      id: deviceId,
      ownerUserId: ADMIN_USER_ID,
      capabilities: ["tap"],
      secret,
      tokenId: `token-for-${deviceId}`,
    },
  };
}

async function callScanArm(
  state: AdminState,
  body: unknown,
  pathDeviceId: string = DEVICE_UUID,
): Promise<Response> {
  const req = new Request(SCAN_ARM_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  // deno-lint-ignore no-explicit-any
  const post = (scanArmHandler as any).POST as (
    ctx: {
      req: Request;
      state: AdminState;
      params: { deviceId: string };
    },
  ) => Promise<Response>;
  return await post({
    req,
    state,
    params: { deviceId: pathDeviceId },
  });
}

async function callScanResult(
  state: DeviceState,
  body: unknown,
): Promise<Response> {
  const req = new Request(SCAN_RESULT_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  // deno-lint-ignore no-explicit-any
  const post = (scanResultHandler as any).POST as (
    ctx: { req: Request; state: DeviceState; params: Record<string, string> },
  ) => Promise<Response>;
  return await post({ req, state, params: {} });
}

/**
 * Install scan-arm seams that mimic an in-memory `verifications` table.
 * Returns the in-memory state + helpers so individual tests can assert.
 */
function installScanArmSeams(opts: {
  device?: FakeDevice | null;
} = {}): {
  insertedRows: { identifier: string; value: string; expiresAt: Date }[];
  apnsCalls: { target: unknown; payload: unknown }[];
} {
  const insertedRows: { identifier: string; value: string; expiresAt: Date }[] =
    [];
  const apnsCalls: { target: unknown; payload: unknown }[] = [];

  _setDeviceLoaderForTests((_id) => Promise.resolve(opts.device ?? null));
  _setArmedPairingFinderForTests((_id) => Promise.resolve(null));
  _setPairingInserterForTests((row) => {
    insertedRows.push(row);
    return Promise.resolve();
  });
  _setPairingDeleterForTests((_id) => Promise.resolve());
  _setApnsSenderForTests((target, payload) => {
    apnsCalls.push({ target, payload });
    return Promise.resolve({ ok: true });
  });

  return { insertedRows, apnsCalls };
}

/**
 * Install scan-result seams that mimic an atomic-claim store. The first
 * call for a given identifier "claims" it; subsequent calls return null
 * (consumed). An identifier in `expiredIdentifiers` is treated as expired.
 */
function installScanResultSeams(opts: {
  /** Pairing rows that exist and are armed; map is identifier → purpose. */
  armed?: Map<string, string>;
  /** Already-expired identifiers — claimer always returns null for these. */
  expiredIdentifiers?: Set<string>;
  /** Enrichment lookup result. */
  enrichment?: {
    found: boolean;
    tag?: { displayName: string | null; tagType: string } | null;
    customer?: { displayName: string | null; slug: string | null } | null;
    subscription?: {
      planLabel: string | null;
      status: "active" | "pending" | "terminated" | "canceled" | null;
      currentPeriodEndIso: string | null;
      billingTier: "standard" | "comped" | null;
    } | null;
  };
}): { claimerCalls: { identifier: string; idTag: string }[] } {
  const armed = opts.armed ?? new Map<string, string>();
  const expired = opts.expiredIdentifiers ?? new Set<string>();
  const claimerCalls: { identifier: string; idTag: string }[] = [];

  _setPairingClaimerForTests((identifier, idTag) => {
    claimerCalls.push({ identifier, idTag });
    if (expired.has(identifier)) return Promise.resolve(null);
    const purpose = armed.get(identifier);
    if (!purpose) return Promise.resolve(null);
    // Single-use: drop on first claim so a replay returns null.
    armed.delete(identifier);
    return Promise.resolve({ id: `verif-${identifier}`, purpose });
  });

  _setEnricherForTests(() => {
    const e = opts.enrichment ?? { found: false };
    return Promise.resolve({
      found: e.found,
      tag: e.tag ?? null,
      customer: e.customer ?? null,
      subscription: e.subscription ?? null,
    });
  });

  return { claimerCalls };
}

function tearDown(): void {
  _resetScanArmTestSeams();
  _resetScanResultTestSeams();
  eventBus._reset();
}

/**
 * Subscribe to `device.scan.requested` exactly the way the
 * `/api/devices/scan-stream` handler does — filtered by deviceId. Returns
 * a captured-list + unsub. Mirrors `scan-stream.ts:138-145`.
 */
function subscribeAsScanStream(
  deviceId: string,
): {
  scanRequests: DeliveredEvent[];
  tokenRevocations: DeliveredEvent[];
  sessionReplaced: DeliveredEvent[];
  unsub: () => void;
} {
  const scanRequests: DeliveredEvent[] = [];
  const tokenRevocations: DeliveredEvent[] = [];
  const sessionReplaced: DeliveredEvent[] = [];
  const unsub = eventBus.subscribe(
    [
      "device.scan.requested",
      "device.session.replaced",
      "device.token.revoked",
    ],
    (delivered) => {
      const p = delivered.payload as { deviceId?: string };
      if (p.deviceId !== deviceId) return;
      if (delivered.type === "device.scan.requested") {
        scanRequests.push(delivered);
      } else if (delivered.type === "device.token.revoked") {
        tokenRevocations.push(delivered);
      } else if (delivered.type === "device.session.replaced") {
        sessionReplaced.push(delivered);
      }
    },
  );
  return { scanRequests, tokenRevocations, sessionReplaced, unsub };
}

/**
 * Subscribe to `scan.intercepted` exactly the way the
 * `/api/auth/scan-detect?pairingCode=…&deviceId=…` SSE handler does:
 * filter by `(pairableType, pairableId, pairingCode)`. Mirrors
 * `scan-detect.ts:339-354`.
 */
function subscribeAsScanDetect(
  binding: { pairableType: "device"; pairableId: string; pairingCode: string },
): {
  events: DeliveredEvent[];
  unsub: () => void;
} {
  const events: DeliveredEvent[] = [];
  const unsub = eventBus.subscribe(["scan.intercepted"], (delivered) => {
    const p = delivered.payload as {
      pairableType: string;
      pairableId: string;
      pairingCode: string;
    };
    if (p.pairableType !== binding.pairableType) return;
    if (p.pairableId !== binding.pairableId) return;
    if (p.pairingCode !== binding.pairingCode) return;
    events.push(delivered);
  });
  return { events, unsub };
}

// ============================================================================
// 1. Happy path — full arm → SSE → scan-result → modal-intercept flow
// ============================================================================

Deno.test({
  name:
    "e2e — happy path: admin arm → SSE notify → scan-result → modal sees scan.intercepted",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    eventBus._reset();
    const seams = installScanArmSeams({
      device: makeOnlineDevice({
        pushToken: "0123456789abcdef",
        apnsEnvironment: "sandbox",
      }),
    });

    // ----- Step 3 setup: subscribe AS the iOS-side SSE consumer. This is
    // the same subscribe-call shape the scan-stream.ts handler uses, with
    // the same deviceId filter. Subscribing BEFORE the arm so we exercise
    // the live-subscription path (replay path tested separately below).
    const stream = subscribeAsScanStream(DEVICE_UUID);

    try {
      // ---- Step 1: admin arms a scan ----
      const armRes = await callScanArm(adminState(), {
        purpose: "admin-link",
        hintLabel: "Front desk",
      });
      assertEquals(armRes.status, 200);
      const armBody = await armRes.json();
      assertEquals(armBody.ok, true);
      assertEquals(armBody.deviceId, DEVICE_UUID);
      assertEquals(armBody.purpose, "admin-link");
      assertEquals(armBody.expiresInSec, 90);
      assert(
        /^[A-Z2-9]{6}$/.test(armBody.pairingCode),
        `pairingCode shape wrong: ${armBody.pairingCode}`,
      );
      const pairingCode: string = armBody.pairingCode;

      // ---- Step 2 verification: device.scan.requested fired ----
      assertEquals(
        stream.scanRequests.length,
        1,
        "device.scan.requested must fire on arm",
      );
      const scanReqPayload = stream.scanRequests[0].payload as {
        deviceId: string;
        pairingCode: string;
        purpose: string;
      };
      assertEquals(scanReqPayload.deviceId, DEVICE_UUID);
      assertEquals(scanReqPayload.pairingCode, pairingCode);
      assertEquals(scanReqPayload.purpose, "admin-link");

      // Verify the pairing row was inserted with the canonical identifier.
      assertEquals(seams.insertedRows.length, 1);
      assertEquals(
        seams.insertedRows[0].identifier,
        `device-scan:${DEVICE_UUID}:${pairingCode}`,
      );

      // ---- Step 4: iOS sim computes HMAC nonce ----
      const idTag = "04AB12CDEF1234"; // hex uppercase already
      const ts = Math.floor(Date.now() / 1000);
      const nonce = await _signNonceForTests(
        ZERO_SECRET,
        idTag,
        pairingCode,
        DEVICE_UUID,
        ts,
      );

      // ----- Step 5 setup: subscribe AS the browser modal SSE -----
      const modal = subscribeAsScanDetect({
        pairableType: "device",
        pairableId: DEVICE_UUID,
        pairingCode,
      });

      // Install scan-result seams: pairing is armed, claim succeeds,
      // enrichment returns "found" with a populated customer block.
      const armedMap = new Map([
        [
          `device-scan:${DEVICE_UUID}:${pairingCode}`,
          "admin-link",
        ],
      ]);
      const resultSeams = installScanResultSeams({
        armed: armedMap,
        enrichment: {
          found: true,
          tag: { displayName: "Alice's tag", tagType: "ev_card" },
          customer: { displayName: "Alice", slug: "alice" },
          subscription: {
            planLabel: "Standard",
            status: "active",
            currentPeriodEndIso: "2026-12-31T00:00:00Z",
            billingTier: "standard",
          },
        },
      });

      // ---- Step 5: POST /api/devices/scan-result ----
      const resultRes = await callScanResult(
        deviceState(DEVICE_UUID, ZERO_SECRET),
        { idTag, pairingCode, ts, nonce },
      );
      assertEquals(resultRes.status, 200);
      const resultBody = await resultRes.json();
      assertEquals(resultBody.ok, true);
      assertEquals(resultBody.found, true);
      assertEquals(resultBody.idTag, idTag);
      assertEquals(resultBody.pairingCode, pairingCode);
      assertEquals(typeof resultBody.resolvedAtIso, "string");
      assertEquals(resultBody.tag.displayName, "Alice's tag");
      assertEquals(resultBody.tag.tagType, "ev_card");
      assertEquals(resultBody.customer.displayName, "Alice");
      assertEquals(resultBody.subscription.planLabel, "Standard");
      assertEquals(resultBody.subscription.status, "active");

      // The handler called the claimer with the canonical identifier.
      assertEquals(resultSeams.claimerCalls.length, 1);
      assertEquals(
        resultSeams.claimerCalls[0].identifier,
        `device-scan:${DEVICE_UUID}:${pairingCode}`,
      );
      assertEquals(resultSeams.claimerCalls[0].idTag, idTag);

      // ---- Step 6: assert scan.intercepted fired with the right payload ----
      assertEquals(
        modal.events.length,
        1,
        "scan.intercepted must fire on successful scan-result",
      );
      const intercepted = modal.events[0].payload as {
        idTag: string;
        pairableType: string;
        pairableId: string;
        pairingCode: string;
        purpose: string;
        source: string;
        t: number;
      };
      assertEquals(intercepted.idTag, idTag);
      assertEquals(intercepted.pairableType, "device");
      assertEquals(intercepted.pairableId, DEVICE_UUID);
      assertEquals(intercepted.pairingCode, pairingCode);
      assertEquals(intercepted.purpose, "admin-link");
      assertEquals(intercepted.source, "device-scan-result");
      assertEquals(typeof intercepted.t, "number");

      modal.unsub();
    } finally {
      stream.unsub();
      tearDown();
    }
  },
});

// ============================================================================
// 2. Happy path — found:false branch (idTag has no mapping)
// ============================================================================

Deno.test({
  name:
    "e2e — happy path with unmapped idTag returns 200 found:false but still publishes scan.intercepted",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    eventBus._reset();
    installScanArmSeams({ device: makeOnlineDevice() });

    try {
      const armRes = await callScanArm(adminState(), {
        purpose: "admin-link",
      });
      const armBody = await armRes.json();
      const pairingCode: string = armBody.pairingCode;

      const idTag = "DEADBEEFCAFE";
      const ts = Math.floor(Date.now() / 1000);
      const nonce = await _signNonceForTests(
        ZERO_SECRET,
        idTag,
        pairingCode,
        DEVICE_UUID,
        ts,
      );

      const modal = subscribeAsScanDetect({
        pairableType: "device",
        pairableId: DEVICE_UUID,
        pairingCode,
      });

      installScanResultSeams({
        armed: new Map([[
          `device-scan:${DEVICE_UUID}:${pairingCode}`,
          "admin-link",
        ]]),
        enrichment: { found: false },
      });

      const res = await callScanResult(
        deviceState(DEVICE_UUID, ZERO_SECRET),
        { idTag, pairingCode, ts, nonce },
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.found, false);
      assertEquals(body.tag, null);
      assertEquals(body.customer, null);
      assertEquals(body.subscription, null);

      assertEquals(modal.events.length, 1);
      modal.unsub();
    } finally {
      tearDown();
    }
  },
});

// ============================================================================
// 3. HMAC mismatch at scan-result → 401, no scan.intercepted fired
// ============================================================================

Deno.test({
  name:
    "e2e — HMAC mismatch at step 5 returns 401 and does NOT publish scan.intercepted",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    eventBus._reset();
    installScanArmSeams({ device: makeOnlineDevice() });

    try {
      const armRes = await callScanArm(adminState(), {
        purpose: "admin-link",
      });
      const pairingCode: string = (await armRes.json()).pairingCode;

      const idTag = "04AB12CDEF1234";
      const ts = Math.floor(Date.now() / 1000);
      // Wrong nonce — valid hex shape but wrong value.
      const nonce = "0".repeat(64);

      const modal = subscribeAsScanDetect({
        pairableType: "device",
        pairableId: DEVICE_UUID,
        pairingCode,
      });
      // Even with seams installed, the claimer MUST NOT be called when the
      // HMAC fails — assert the claimer wasn't called below.
      const seams = installScanResultSeams({
        armed: new Map([[
          `device-scan:${DEVICE_UUID}:${pairingCode}`,
          "admin-link",
        ]]),
      });

      const res = await callScanResult(
        deviceState(DEVICE_UUID, ZERO_SECRET),
        { idTag, pairingCode, ts, nonce },
      );
      assertEquals(res.status, 401);
      const body = await res.json();
      assertEquals(body.error, "invalid_nonce");

      assertEquals(
        seams.claimerCalls.length,
        0,
        "HMAC failure must short-circuit BEFORE the atomic claim",
      );
      assertEquals(
        modal.events.length,
        0,
        "scan.intercepted MUST NOT fire on HMAC mismatch",
      );
      modal.unsub();
    } finally {
      tearDown();
    }
  },
});

// ============================================================================
// 4. Pairing already consumed → 429, no double-fire
// ============================================================================

Deno.test({
  name:
    "e2e — pairing already consumed at step 5 returns 429 with no double-fire",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    eventBus._reset();
    installScanArmSeams({ device: makeOnlineDevice() });

    try {
      const armRes = await callScanArm(adminState(), {
        purpose: "admin-link",
      });
      const pairingCode: string = (await armRes.json()).pairingCode;

      const idTag = "04AB12CDEF1234";
      const ts = Math.floor(Date.now() / 1000);
      const nonce = await _signNonceForTests(
        ZERO_SECRET,
        idTag,
        pairingCode,
        DEVICE_UUID,
        ts,
      );

      const modal = subscribeAsScanDetect({
        pairableType: "device",
        pairableId: DEVICE_UUID,
        pairingCode,
      });

      // First call consumes the pairing.
      const armedMap = new Map([[
        `device-scan:${DEVICE_UUID}:${pairingCode}`,
        "admin-link",
      ]]);
      installScanResultSeams({
        armed: armedMap,
        enrichment: { found: false },
      });

      const r1 = await callScanResult(
        deviceState(DEVICE_UUID, ZERO_SECRET),
        { idTag, pairingCode, ts, nonce },
      );
      assertEquals(r1.status, 200);
      assertEquals(modal.events.length, 1, "first call publishes once");

      // Second call should hit the no-row branch (consumed) → 429.
      // Use a fresh ts so HMAC matches; the in-memory store has dropped
      // the row already.
      const ts2 = ts + 1;
      const nonce2 = await _signNonceForTests(
        ZERO_SECRET,
        idTag,
        pairingCode,
        DEVICE_UUID,
        ts2,
      );
      const r2 = await callScanResult(
        deviceState(DEVICE_UUID, ZERO_SECRET),
        { idTag, pairingCode, ts: ts2, nonce: nonce2 },
      );
      assertEquals(r2.status, 429);
      const body2 = await r2.json();
      assertEquals(body2.error, "rate_limited");

      assertEquals(
        modal.events.length,
        1,
        "scan.intercepted MUST NOT double-fire on consumed pairing",
      );
      modal.unsub();
    } finally {
      tearDown();
    }
  },
});

// ============================================================================
// 5. Pairing expired → 429
// ============================================================================

Deno.test({
  name: "e2e — expired pairing at step 5 returns 429 (anti-enumeration)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    eventBus._reset();
    installScanArmSeams({ device: makeOnlineDevice() });

    try {
      const armRes = await callScanArm(adminState(), {
        purpose: "admin-link",
      });
      const pairingCode: string = (await armRes.json()).pairingCode;

      const idTag = "04AB12CDEF1234";
      const ts = Math.floor(Date.now() / 1000);
      const nonce = await _signNonceForTests(
        ZERO_SECRET,
        idTag,
        pairingCode,
        DEVICE_UUID,
        ts,
      );

      const modal = subscribeAsScanDetect({
        pairableType: "device",
        pairableId: DEVICE_UUID,
        pairingCode,
      });

      // Mark the identifier as expired — claimer returns null even on first
      // call. The handler can't distinguish expired from consumed: both
      // funnel to 429 to defeat enumeration.
      installScanResultSeams({
        expiredIdentifiers: new Set([
          `device-scan:${DEVICE_UUID}:${pairingCode}`,
        ]),
      });

      const res = await callScanResult(
        deviceState(DEVICE_UUID, ZERO_SECRET),
        { idTag, pairingCode, ts, nonce },
      );
      assertEquals(res.status, 429);
      const body = await res.json();
      assertEquals(body.error, "rate_limited");

      assertEquals(
        modal.events.length,
        0,
        "expired pairing must not publish scan.intercepted",
      );
      modal.unsub();
    } finally {
      tearDown();
    }
  },
});

// ============================================================================
// 6. Cross-device isolation — wrong-deviceId stream filters out the event
// ============================================================================

Deno.test({
  name:
    "e2e — wrong-device SSE consumer does NOT receive scan.requested for another device",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    eventBus._reset();
    installScanArmSeams({ device: makeOnlineDevice() });

    try {
      // Two simulated SSE consumers — one bound to OUR device, one bound
      // to an unrelated device. Only our consumer must receive the event.
      const ours = subscribeAsScanStream(DEVICE_UUID);
      const others = subscribeAsScanStream(OTHER_DEVICE_UUID);

      const armRes = await callScanArm(adminState(), {
        purpose: "admin-link",
      });
      assertEquals(armRes.status, 200);

      assertEquals(
        ours.scanRequests.length,
        1,
        "our device must receive its own scan.requested",
      );
      assertEquals(
        others.scanRequests.length,
        0,
        "other device MUST NOT see our scan.requested (cross-device isolation)",
      );

      ours.unsub();
      others.unsub();
    } finally {
      tearDown();
    }
  },
});

// ============================================================================
// 7. Token revocation — device.token.revoked closes the stream
// ============================================================================

Deno.test({
  name:
    "e2e — device.token.revoked event delivered to the matching device's stream",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    eventBus._reset();

    try {
      const stream = subscribeAsScanStream(DEVICE_UUID);

      // Production token-revoke flow publishes this event. The SSE
      // handler's subscriber closes itself on receipt; here we assert the
      // event reaches the bound stream.
      eventBus.publish({
        type: "device.token.revoked",
        payload: {
          deviceId: DEVICE_UUID,
          tokenId: "tok-1",
          reason: "admin",
        },
      });

      // A revocation for ANOTHER device must not affect this stream.
      eventBus.publish({
        type: "device.token.revoked",
        payload: {
          deviceId: OTHER_DEVICE_UUID,
          tokenId: "tok-2",
          reason: "admin",
        },
      });

      assertEquals(stream.tokenRevocations.length, 1);
      const p = stream.tokenRevocations[0].payload as { deviceId: string };
      assertEquals(p.deviceId, DEVICE_UUID);
      stream.unsub();
    } finally {
      tearDown();
    }
  },
});

// ============================================================================
// 8. Replay buffer — connect with Last-Event-ID after publish, replay arrives
// ============================================================================

Deno.test({
  name:
    "e2e — Last-Event-ID replay returns matching device.scan.requested events",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    eventBus._reset();
    installScanArmSeams({ device: makeOnlineDevice() });

    try {
      // Arm the scan BEFORE any subscriber — the event lands in the bus's
      // ring buffer.
      const armRes = await callScanArm(adminState(), {
        purpose: "admin-link",
      });
      assertEquals(armRes.status, 200);
      const armBody = await armRes.json();
      const pairingCode: string = armBody.pairingCode;

      // The published event got a non-zero seq.
      const buffered = eventBus.replay(0, ["device.scan.requested"]);
      assertEquals(buffered.length, 1);
      const seqOfArmed = buffered[0].seq;
      assertNotEquals(seqOfArmed, 0);

      // Now simulate the iOS app reconnecting with Last-Event-ID = 0
      // (i.e. it never saw any prior events). The scan-stream handler
      // calls eventBus.replay(lastEventId, …) and filters by deviceId.
      const replayed = eventBus
        .replay(0, ["device.scan.requested"])
        .filter((e) =>
          (e.payload as { deviceId: string }).deviceId === DEVICE_UUID
        );
      assertEquals(replayed.length, 1);
      assertEquals(
        (replayed[0].payload as { pairingCode: string }).pairingCode,
        pairingCode,
      );

      // Reconnecting with Last-Event-ID >= seqOfArmed should return zero
      // matching events — the handler honors the seq cursor.
      const afterCursor = eventBus
        .replay(seqOfArmed, ["device.scan.requested"]);
      assertEquals(
        afterCursor.length,
        0,
        "replay must respect the Last-Event-ID cursor",
      );
    } finally {
      tearDown();
    }
  },
});

// ============================================================================
// 9. HMAC fixture vectors — load and verify against the canonical signer.
// Belt-and-braces: the e2e test would silently pass if the fixture got
// out of sync with the production signer; this test catches that.
// ============================================================================

interface HmacVector {
  comment?: string;
  deviceSecretBase64URL: string;
  idTag: string;
  pairingCode: string;
  deviceId: string;
  ts: number;
  expectedHex: string;
}

Deno.test({
  name: "e2e — HMAC fixture vectors match the production signer",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const fixturePath = new URL(
      "../../fixtures/hmac-vectors.json",
      import.meta.url,
    );
    const json = await Deno.readTextFile(fixturePath);
    const vectors = JSON.parse(json) as HmacVector[];
    assert(vectors.length >= 2, "expected at least 2 fixture vectors");
    for (const v of vectors) {
      const got = await _signNonceForTests(
        v.deviceSecretBase64URL,
        v.idTag,
        v.pairingCode,
        v.deviceId,
        v.ts,
      );
      assertEquals(
        got,
        v.expectedHex,
        `vector mismatch: ${v.comment ?? "(no comment)"}`,
      );
    }
  },
});

// ============================================================================
// 10. AASA manifest — file exists, is valid JSON, and matches the spec.
// Apple's validator fetches this exact byte-stream; a missing or malformed
// file silently breaks Universal Links on the iOS app's first install.
// ============================================================================

Deno.test({
  name:
    "e2e — apple-app-site-association.json is valid JSON with the documented bundle ID",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const aasaPath = new URL(
      "../../../routes/.well-known/apple-app-site-association.json",
      import.meta.url,
    );
    const text = await Deno.readTextFile(aasaPath);
    const parsed = JSON.parse(text) as {
      applinks: {
        apps: string[];
        details: Array<
          { appIDs: string[]; components: Array<{ "/": string }> }
        >;
      };
    };
    assertEquals(parsed.applinks.apps, []);
    assertEquals(parsed.applinks.details.length, 1);
    const detail = parsed.applinks.details[0];
    assertEquals(detail.appIDs, ["48H7CLBV8Y.gg.vlad.expresscan"]);
    assertEquals(detail.components.length, 1);
    assertEquals(detail.components[0]["/"], "/expresscan/register/*");
  },
});

// ============================================================================
// 11. AASA route handler — returns 200 with Content-Type: application/json,
// no redirects. Apple's validator requires this.
// ============================================================================

Deno.test({
  name:
    "e2e — AASA route handler returns 200 application/json with the manifest body",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { handler } = await import(
      "../../../routes/.well-known/apple-app-site-association.ts"
    );
    // deno-lint-ignore no-explicit-any
    const get = (handler as any).GET as (
      ctx: { req: Request; state: unknown; params: Record<string, string> },
    ) => Response | Promise<Response>;
    const res = await get({
      req: new Request(
        "https://manage.polaris.express/.well-known/apple-app-site-association",
        { method: "GET" },
      ),
      state: {},
      params: {},
    });
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "application/json");
    const body = await res.json() as {
      applinks: { details: Array<{ appIDs: string[] }> };
    };
    assertEquals(
      body.applinks.details[0].appIDs[0],
      "48H7CLBV8Y.gg.vlad.expresscan",
    );
  },
});

// ============================================================================
// 12. Route classifier — /.well-known/* must be PUBLIC so Apple's validator
// can reach it without auth, on either surface.
// ============================================================================

Deno.test({
  name:
    "e2e — /.well-known/apple-app-site-association is classified PUBLIC on both surfaces",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { classifyRoute } = await import(
      "../../../src/lib/route-classifier.ts"
    );
    assertEquals(
      classifyRoute("/.well-known/apple-app-site-association", "admin"),
      "PUBLIC",
    );
    assertEquals(
      classifyRoute("/.well-known/apple-app-site-association", "customer"),
      "PUBLIC",
    );
  },
});

/**
 * scan_login_test.ts — cross-process regression suite for the
 * scan-to-login OCPP intercept feature.
 *
 * The runner (`runner.ts`) must:
 *   1. Generate a per-run env (harness/env.ts).
 *   2. Build the cpsim Go binary.
 *   3. `docker compose up --build --wait` the test stack.
 *   4. Seed the databases (harness/seed.ts).
 *   5. Export env vars consumed below (TEST_PROJECT, TEST_ENV_PATH,
 *      EXPRESSYNC_BASE_URL, STEVE_WS_URL, CPSIM_BIN, plus the values
 *      from the generated env).
 *   6. Run `deno test` against this file.
 *   7. Teardown unconditionally.
 *
 * Each scenario is a `Deno.test` step on the shared stack. Scenarios that
 * mutate the SteVe container (timeout/HMAC overrides) call
 * `recreateService` and restore at the end.
 */

import { assert, assertEquals } from "@std/assert";
import { type ComposeContext, execInService, recreateService, streamLogs } from "./harness/compose.ts";
import { Cpsim } from "./harness/cpsim.ts";
import { pgQueryJson, pgQuery, mysqlQuery } from "./harness/db.ts";
import { openSse } from "./harness/sse.ts";
import { assertEventually, assertWithinMs, hmacHexSign } from "./harness/assert.ts";

function envOrThrow(k: string): string {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
}

const PROJECT = envOrThrow("TEST_PROJECT");
const ENV_PATH = envOrThrow("TEST_ENV_PATH");
const BASE_URL = envOrThrow("EXPRESSYNC_BASE_URL"); // http://127.0.0.1:NNNN
const STEVE_WS_URL = envOrThrow("STEVE_WS_URL"); // ws://127.0.0.1:NNNN/steve/websocket/CentralSystemService
const CPSIM_BIN = envOrThrow("CPSIM_BIN");
const STEVE_PREAUTH_HMAC_KEY = envOrThrow("STEVE_PREAUTH_HMAC_KEY");
const STEVE_DB_PASSWORD = envOrThrow("STEVE_DB_PASSWORD");
const CB_A = envOrThrow("CB_A");
const CB_B = envOrThrow("CB_B");
const TAG_GOOD = envOrThrow("TAG_GOOD");
const TAG_BLOCKED = envOrThrow("TAG_BLOCKED");
const TAG_UNKNOWN = envOrThrow("TAG_UNKNOWN");

const ctx: ComposeContext = { project: PROJECT, envPath: ENV_PATH };

async function newCpsim(chargeBoxId: string): Promise<Cpsim> {
  const sim = await Cpsim.spawn(CPSIM_BIN);
  await sim.connect(`${STEVE_WS_URL}/${chargeBoxId}`, chargeBoxId);
  await sim.bootNotification();
  await sim.statusNotification(1, "Available");
  return sim;
}

async function armScanPair(
  chargeBoxId: string,
): Promise<{ pairingCode: string }> {
  const r = await fetch(`${BASE_URL}/api/auth/scan-pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chargeBoxId }),
  });
  if (!r.ok) {
    throw new Error(`scan-pair failed: ${r.status} ${await r.text()}`);
  }
  return await r.json();
}

async function detectStream(chargeBoxId: string, pairingCode: string) {
  const url = `${BASE_URL}/api/auth/scan-detect?chargeBoxId=${encodeURIComponent(chargeBoxId)}&pairingCode=${encodeURIComponent(pairingCode)}`;
  return await openSse(url);
}

async function clearVerifications() {
  await pgQuery(ctx, null, `DELETE FROM verifications WHERE identifier LIKE 'scan-pair:%';`);
}

async function clearOperationLog() {
  await pgQuery(ctx, null, `DELETE FROM charger_operation_log;`).catch(() => {/* table optional */});
}

Deno.test({
  name: "scan-login intercept regression suite",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const steveLogs = streamLogs(ctx, "steve");
    const appLogs = streamLogs(ctx, "expressync-app");

    // --- 1. Control ---------------------------------------------------------
    await t.step("1. control: TAG_GOOD without armed intent → Accepted, tx starts", async () => {
      await clearVerifications();
      const sim = await newCpsim(CB_A);
      try {
        const auth = await sim.authorize(TAG_GOOD);
        assertEquals(auth.status, "Accepted", "control authorize should be Accepted");
        const tx = await sim.startTransaction(1, TAG_GOOD);
        assert(tx.transactionId > 0, "transactionId should be present");
        // Verify SteVe persisted the transaction.
        await assertEventually(async () => {
          const rows = await mysqlQuery(ctx, STEVE_DB_PASSWORD, `SELECT transaction_pk FROM transaction WHERE transaction_pk = ${tx.transactionId};`);
          return rows.length === 1;
        }, { timeoutMs: 5_000, message: "transaction row missing" });
        await sim.stopTransaction(tx.transactionId);
      } finally {
        await sim.dispose();
      }
    });

    // --- 2. Happy path login ------------------------------------------------
    await t.step("2. happy path: armed → Authorize Blocked, scan-detect SSE fires, scan-login 200", async () => {
      await clearVerifications();
      const { pairingCode } = await armScanPair(CB_A);
      const sse = await detectStream(CB_A, pairingCode);
      const sim = await newCpsim(CB_A);
      try {
        const auth = await sim.authorize(TAG_GOOD);
        assertEquals(auth.status, "Blocked", "preauth must override to Blocked");
        // SSE delivers the intercepted event.
        const msg = await sse.next(10_000);
        const payload = JSON.parse(msg.data) as { idTag: string; nonce: string; t: number };
        assertEquals(payload.idTag, TAG_GOOD);
        assert(typeof payload.nonce === "string" && payload.nonce.length > 0);

        // Now drive scan-login.
        const loginResp = await fetch(`${BASE_URL}/api/auth/scan-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chargeBoxId: CB_A,
            pairingCode,
            idTag: payload.idTag,
            nonce: payload.nonce,
            t: payload.t,
          }),
        });
        assertEquals(loginResp.status, 200, `scan-login expected 200, got ${loginResp.status} ${await loginResp.clone().text()}`);
        const setCookie = loginResp.headers.get("set-cookie");
        assert(setCookie, "scan-login should set a session cookie");
      } finally {
        sse.close();
        await sim.dispose();
      }
    });

    // --- 3. Wrong charger ---------------------------------------------------
    await t.step("3. wrong charger: arm CB_A, scan at CB_B → Accepted, tx starts, no SSE", async () => {
      await clearVerifications();
      const { pairingCode } = await armScanPair(CB_A);
      const sse = await detectStream(CB_A, pairingCode);
      const sim = await newCpsim(CB_B);
      let sseFired = false;
      sse.next(2_000).then(() => { sseFired = true; }).catch(() => {/* expected */});
      try {
        const auth = await sim.authorize(TAG_GOOD);
        assertEquals(auth.status, "Accepted");
        const tx = await sim.startTransaction(1, TAG_GOOD);
        assert(tx.transactionId > 0);
        await new Promise((r) => setTimeout(r, 2_500));
        assertEquals(sseFired, false, "SSE must NOT fire for the wrong charger");
        await sim.stopTransaction(tx.transactionId);
      } finally {
        sse.close();
        await sim.dispose();
      }
    });

    // --- 4. Unknown tag during armed window ---------------------------------
    await t.step("4. unknown tag: original INVALID stays INVALID; scan.intercepted still fires", async () => {
      await clearVerifications();
      const { pairingCode } = await armScanPair(CB_A);
      const sse = await detectStream(CB_A, pairingCode);
      const sim = await newCpsim(CB_A);
      try {
        const auth = await sim.authorize(TAG_UNKNOWN);
        assertEquals(auth.status, "Invalid", "unknown tag stays Invalid (preauth only overrides ACCEPTED)");
        const msg = await sse.next(10_000);
        const payload = JSON.parse(msg.data) as { idTag: string };
        assertEquals(payload.idTag, TAG_UNKNOWN, "scan.intercepted forwards even for unknown tags");
      } finally {
        sse.close();
        await sim.dispose();
      }
    });

    // --- 5. Hook timeout (steve restart with PREAUTH_TIMEOUT_MS=1) ----------
    await t.step("5. hook timeout: SteVe fails open, Authorize Accepted, tx starts", async () => {
      await clearVerifications();
      // Bounce SteVe with an aggressive timeout.
      Deno.env.set("PREAUTH_TIMEOUT_MS_OVERRIDE", "1");
      try {
        await recreateService(ctx, "steve");
        await assertEventually(async () => {
          const r = await fetch(`${BASE_URL}/`); // app should be reachable; just probe steve via sim.
          return r.status > 0;
        }, { timeoutMs: 60_000, intervalMs: 1_000 });
        // Wait for SteVe to be reachable on its WS again.
        await assertEventually(async () => {
          const sim = await Cpsim.spawn(CPSIM_BIN);
          try {
            await sim.connect(`${STEVE_WS_URL}/${CB_A}`, CB_A);
            await sim.bootNotification();
            return true;
          } catch {
            return false;
          } finally {
            await sim.dispose();
          }
        }, { timeoutMs: 180_000, intervalMs: 2_000, message: "steve not back after restart" });

        const { pairingCode: _ } = await armScanPair(CB_A);
        const sim = await newCpsim(CB_A);
        try {
          const auth = await sim.authorize(TAG_GOOD);
          assertEquals(auth.status, "Accepted", "timeout → fail-open → Accepted");
          const tx = await sim.startTransaction(1, TAG_GOOD);
          assert(tx.transactionId > 0);
          await sim.stopTransaction(tx.transactionId);
        } finally {
          await sim.dispose();
        }
      } finally {
        Deno.env.delete("PREAUTH_TIMEOUT_MS_OVERRIDE");
        await recreateService(ctx, "steve");
        await assertEventually(async () => {
          const sim = await Cpsim.spawn(CPSIM_BIN);
          try {
            await sim.connect(`${STEVE_WS_URL}/${CB_A}`, CB_A);
            await sim.bootNotification();
            return true;
          } catch {
            return false;
          } finally { await sim.dispose(); }
        }, { timeoutMs: 180_000, intervalMs: 2_000 });
      }
    });

    // --- 6. Hook 5xx --------------------------------------------------------
    // We point PREAUTH_URL at a tiny Deno HTTP stub running on the host.
    // Since SteVe lives in docker, we expose the stub on host.docker.internal.
    await t.step("6. hook 5xx: fail open", async () => {
      await clearVerifications();
      const stub = Deno.serve({ port: 0, hostname: "0.0.0.0" }, () => new Response("oops", { status: 500 }));
      const port = stub.addr.port;
      const stubUrl = `http://host.docker.internal:${port}/api/ocpp/pre-authorize`;
      Deno.env.set("PREAUTH_URL_OVERRIDE", stubUrl);
      try {
        await recreateService(ctx, "steve");
        await assertEventually(async () => {
          const sim = await Cpsim.spawn(CPSIM_BIN);
          try {
            await sim.connect(`${STEVE_WS_URL}/${CB_A}`, CB_A);
            await sim.bootNotification();
            return true;
          } catch { return false; } finally { await sim.dispose(); }
        }, { timeoutMs: 180_000, intervalMs: 2_000 });
        const sim = await newCpsim(CB_A);
        try {
          const auth = await sim.authorize(TAG_GOOD);
          assertEquals(auth.status, "Accepted", "5xx → fail open");
        } finally { await sim.dispose(); }
      } finally {
        Deno.env.delete("PREAUTH_URL_OVERRIDE");
        await stub.shutdown();
        await recreateService(ctx, "steve");
        await assertEventually(async () => {
          const sim = await Cpsim.spawn(CPSIM_BIN);
          try {
            await sim.connect(`${STEVE_WS_URL}/${CB_A}`, CB_A);
            await sim.bootNotification();
            return true;
          } catch { return false; } finally { await sim.dispose(); }
        }, { timeoutMs: 180_000, intervalMs: 2_000 });
      }
    });

    // --- 7. Malformed JSON --------------------------------------------------
    await t.step("7. hook malformed JSON: fail open", async () => {
      await clearVerifications();
      const stub = Deno.serve({ port: 0, hostname: "0.0.0.0" }, () => new Response("not-json", { status: 200, headers: { "Content-Type": "application/json" } }));
      const port = stub.addr.port;
      Deno.env.set("PREAUTH_URL_OVERRIDE", `http://host.docker.internal:${port}/api/ocpp/pre-authorize`);
      try {
        await recreateService(ctx, "steve");
        await assertEventually(async () => {
          const sim = await Cpsim.spawn(CPSIM_BIN);
          try {
            await sim.connect(`${STEVE_WS_URL}/${CB_A}`, CB_A);
            await sim.bootNotification();
            return true;
          } catch { return false; } finally { await sim.dispose(); }
        }, { timeoutMs: 180_000, intervalMs: 2_000 });
        const sim = await newCpsim(CB_A);
        try {
          const auth = await sim.authorize(TAG_GOOD);
          assertEquals(auth.status, "Accepted", "malformed JSON → fail open");
        } finally { await sim.dispose(); }
      } finally {
        Deno.env.delete("PREAUTH_URL_OVERRIDE");
        await stub.shutdown();
        await recreateService(ctx, "steve");
        await assertEventually(async () => {
          const sim = await Cpsim.spawn(CPSIM_BIN);
          try {
            await sim.connect(`${STEVE_WS_URL}/${CB_A}`, CB_A);
            await sim.bootNotification();
            return true;
          } catch { return false; } finally { await sim.dispose(); }
        }, { timeoutMs: 180_000, intervalMs: 2_000 });
      }
    });

    // --- 8. HMAC mismatch ---------------------------------------------------
    await t.step("8. HMAC mismatch: ExpresSync 401, SteVe fails open", async () => {
      await clearVerifications();
      // Override only ExpresSync's key so it diverges from SteVe's.
      Deno.env.set("EXPRESSYNC_PREAUTH_HMAC_KEY", "DIFFERENT_KEY_" + crypto.randomUUID());
      try {
        await recreateService(ctx, "expressync-app");
        await assertEventually(async () => {
          const r = await fetch(`${BASE_URL}/`).catch(() => null);
          return r != null;
        }, { timeoutMs: 60_000, intervalMs: 1_000 });
        const { pairingCode } = await armScanPair(CB_A);
        const sse = await detectStream(CB_A, pairingCode);
        let sseFired = false;
        sse.next(3_000).then(() => { sseFired = true; }).catch(() => {});
        const sim = await newCpsim(CB_A);
        try {
          const auth = await sim.authorize(TAG_GOOD);
          assertEquals(auth.status, "Accepted", "HMAC mismatch → fail open");
          await new Promise((r) => setTimeout(r, 3_500));
          assertEquals(sseFired, false, "no scan.intercepted on HMAC failure");
        } finally { sse.close(); await sim.dispose(); }
      } finally {
        Deno.env.delete("EXPRESSYNC_PREAUTH_HMAC_KEY");
        await recreateService(ctx, "expressync-app");
        await assertEventually(async () => {
          const r = await fetch(`${BASE_URL}/`).catch(() => null);
          return r != null;
        }, { timeoutMs: 60_000, intervalMs: 1_000 });
      }
    });

    // --- 9. Race / watchdog -------------------------------------------------
    await t.step("9. watchdog: hook returns null but DB row armed → RemoteStop after StartTransaction", async () => {
      await clearVerifications();
      await clearOperationLog();
      // Stub returns {override:null} so SteVe lets the start-tx through.
      const stub = Deno.serve({ port: 0, hostname: "0.0.0.0" }, () => new Response(JSON.stringify({ override: null }), { status: 200, headers: { "Content-Type": "application/json" } }));
      const port = stub.addr.port;
      Deno.env.set("PREAUTH_URL_OVERRIDE", `http://host.docker.internal:${port}/api/ocpp/pre-authorize`);
      try {
        await recreateService(ctx, "steve");
        await assertEventually(async () => {
          const sim = await Cpsim.spawn(CPSIM_BIN);
          try { await sim.connect(`${STEVE_WS_URL}/${CB_A}`, CB_A); await sim.bootNotification(); return true; }
          catch { return false; } finally { await sim.dispose(); }
        }, { timeoutMs: 180_000, intervalMs: 2_000 });

        // Manually arm the verifications row.
        const pairingCode = crypto.randomUUID().replace(/-/g, "");
        await pgQuery(ctx, null,
          `INSERT INTO verifications (id, identifier, value, expires_at, created_at, updated_at)
           VALUES ('${crypto.randomUUID()}',
                   'scan-pair:${CB_A}:${pairingCode}',
                   '${JSON.stringify({ chargeBoxId: CB_A, ip: "127.0.0.1", ua: null, status: "armed" }).replace(/'/g, "''")}',
                   now() + interval '90 seconds', now(), now());`);

        const sim = await newCpsim(CB_A);
        try {
          const auth = await sim.authorize(TAG_GOOD);
          assertEquals(auth.status, "Accepted");
          const tx = await sim.startTransaction(1, TAG_GOOD);
          assert(tx.transactionId > 0);

          // Watchdog should fire RemoteStop.
          await assertEventually(async () => {
            const evs = await sim.events(0);
            return evs.some((e) => e.kind === "RemoteStopTransaction");
          }, { timeoutMs: 10_000, message: "watchdog never sent RemoteStop" });

          // Verify charger_operation_log row.
          await assertEventually(async () => {
            const rows = await pgQueryJson<{ params: { reason?: string } }>(ctx,
              `SELECT params FROM charger_operation_log WHERE charge_box_id = '${CB_A}' AND operation = 'RemoteStopTransaction' ORDER BY created_at DESC LIMIT 1`);
            return rows.length > 0 && rows[0].params?.reason === "intercepted-for-login";
          }, { timeoutMs: 5_000, message: "operation log row missing" });
        } finally { await sim.dispose(); }
      } finally {
        Deno.env.delete("PREAUTH_URL_OVERRIDE");
        await stub.shutdown();
        await recreateService(ctx, "steve");
        await assertEventually(async () => {
          const sim = await Cpsim.spawn(CPSIM_BIN);
          try { await sim.connect(`${STEVE_WS_URL}/${CB_A}`, CB_A); await sim.bootNotification(); return true; }
          catch { return false; } finally { await sim.dispose(); }
        }, { timeoutMs: 180_000, intervalMs: 2_000 });
      }
    });

    // --- 10. Intent expired -------------------------------------------------
    await t.step("10. intent expired: preauth finds no armed row → Accepted", async () => {
      await clearVerifications();
      const { pairingCode } = await armScanPair(CB_A);
      // Force-expire the row.
      await pgQuery(ctx, null,
        `UPDATE verifications SET expires_at = now() - interval '10 seconds' WHERE identifier = 'scan-pair:${CB_A}:${pairingCode}';`);
      const sim = await newCpsim(CB_A);
      try {
        const auth = await sim.authorize(TAG_GOOD);
        assertEquals(auth.status, "Accepted");
        const tx = await sim.startTransaction(1, TAG_GOOD);
        assert(tx.transactionId > 0);
        await sim.stopTransaction(tx.transactionId);
      } finally { await sim.dispose(); }
    });

    // --- 11. Blocked tag ----------------------------------------------------
    await t.step("11. blocked tag: Authorize Blocked, no scan.intercepted (hook short-circuits)", async () => {
      await clearVerifications();
      const { pairingCode } = await armScanPair(CB_A);
      const sse = await detectStream(CB_A, pairingCode);
      let sseFired = false;
      sse.next(3_000).then(() => { sseFired = true; }).catch(() => {});
      const sim = await newCpsim(CB_A);
      try {
        const auth = await sim.authorize(TAG_BLOCKED);
        assertEquals(auth.status, "Blocked", "blocked tag stays Blocked from SteVe");
        await new Promise((r) => setTimeout(r, 3_500));
        assertEquals(sseFired, false, "hook short-circuits before calling ExpresSync");
      } finally { sse.close(); await sim.dispose(); }
    });

    // --- 12. Concurrent intents on different chargers -----------------------
    await t.step("12. concurrent intents: CB_A and CB_B intercepted independently", async () => {
      await clearVerifications();
      // Arm both. We need a second mapping for CB_B / TAG_GOOD; the same
      // user_mapping serves both since mapping is per-tag, not per-charger.
      const { pairingCode: pcA } = await armScanPair(CB_A);
      const { pairingCode: pcB } = await armScanPair(CB_B);
      const sseA = await detectStream(CB_A, pcA);
      const sseB = await detectStream(CB_B, pcB);
      const simA = await newCpsim(CB_A);
      const simB = await newCpsim(CB_B);
      try {
        const [aAuth, bAuth] = await Promise.all([
          simA.authorize(TAG_GOOD),
          simB.authorize(TAG_GOOD),
        ]);
        assertEquals(aAuth.status, "Blocked");
        assertEquals(bAuth.status, "Blocked");
        const [mA, mB] = await Promise.all([sseA.next(8_000), sseB.next(8_000)]);
        const pa = JSON.parse(mA.data);
        const pb = JSON.parse(mB.data);
        assertEquals(pa.idTag, TAG_GOOD);
        assertEquals(pb.idTag, TAG_GOOD);
      } finally {
        sseA.close(); sseB.close();
        await simA.dispose(); await simB.dispose();
      }
    });

    // --- 13. Replay / idempotency ------------------------------------------
    await t.step("13. replay: two Authorize for same TAG → both Blocked, only one event", async () => {
      await clearVerifications();
      const { pairingCode } = await armScanPair(CB_A);
      const sse = await detectStream(CB_A, pairingCode);
      const sim = await newCpsim(CB_A);
      try {
        const a1 = await sim.authorize(TAG_GOOD);
        const a2 = await sim.authorize(TAG_GOOD);
        assertEquals(a1.status, "Blocked");
        assertEquals(a2.status, "Blocked");
        const m1 = await sse.next(8_000);
        assertEquals(JSON.parse(m1.data).idTag, TAG_GOOD);
        let secondFired = false;
        sse.next(2_000).then(() => { secondFired = true; }).catch(() => {});
        await new Promise((r) => setTimeout(r, 2_500));
        assertEquals(secondFired, false, "replay must not republish scan.intercepted");
      } finally { sse.close(); await sim.dispose(); }
    });

    // --- 14. Latency: 200 sequential pre-authorize calls, p99 < 50ms --------
    await t.step("14. latency: 200 pre-authorize calls, p99 < 50ms", async () => {
      await clearVerifications();
      const samples: number[] = [];
      for (let i = 0; i < 200; i++) {
        const body = JSON.stringify({
          idTag: TAG_GOOD,
          chargeBoxId: CB_A,
          connectorId: 1,
          isStartTx: false,
          ts: Date.now(),
        });
        const sig = await hmacHexSign(STEVE_PREAUTH_HMAC_KEY, body);
        const t0 = performance.now();
        const r = await fetch(`${BASE_URL}/api/ocpp/pre-authorize`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Signature": sig },
          body,
        });
        const elapsed = performance.now() - t0;
        // Drain body so connection is reusable.
        await r.arrayBuffer();
        if (r.status !== 200) {
          throw new Error(`pre-authorize returned ${r.status}`);
        }
        samples.push(elapsed);
      }
      samples.sort((a, b) => a - b);
      const p50 = samples[Math.floor(samples.length * 0.50)];
      const p99 = samples[Math.floor(samples.length * 0.99)];
      console.log(`[latency] p50=${p50.toFixed(2)}ms p99=${p99.toFixed(2)}ms n=${samples.length}`);
      assert(p99 < 50, `p99 latency ${p99.toFixed(2)}ms must be < 50ms`);
    });

    // wind down log streams
    steveLogs.stop();
    appLogs.stop();
  },
});

/**
 * Tests for `src/lib/apns.ts` — JWT signer + HTTP/2 client.
 *
 * Strategy:
 *   - JWT vector test: sign with a fixed P8 + iat, then verify the resulting
 *     header/claims segments byte-for-byte (deterministic) AND verify the
 *     signature against the matching public key (necessary because ECDSA
 *     `k` is non-deterministic, so segment 3 differs across runs).
 *   - HTTP client test: stand up a `Deno.serve` listener, point an env-var
 *     hostname at it via a stubbed fetch (we monkey-patch globalThis.fetch
 *     so the production path is unchanged). Capture the request, assert all
 *     the canonical headers + body shape are present.
 *   - Cache test: call `sendApns` twice, assert the underlying `signApnsJwt`
 *     ran exactly once inside the 50-min window.
 *
 * Reproducibility — the JWT vector below was generated with this Python
 * snippet (kept in this comment so anyone can regenerate it):
 *
 *   from cryptography.hazmat.primitives.serialization import load_pem_private_key
 *   import jwt, base64
 *   pem = b"""-----BEGIN PRIVATE KEY-----
 *   MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgqc4e19eOunAhkgvQ
 *   FpQfHD1/FUmy2+AmzvX+dCh2FUahRANCAASq30dR/2eKmb/9T5x31XrPdtqCbI1y
 *   ZHJsXOAbSb6xEabK7hvJS1Ocvz5uiKWQ1ceWzj+XwuZ5pj0e3CBhp7OS
 *   -----END PRIVATE KEY-----"""
 *   key = load_pem_private_key(pem, password=None)
 *   token = jwt.encode(
 *     {"iss":"TEAMID9999","iat":1745600000},
 *     key,
 *     algorithm="ES256",
 *     headers={"kid":"KEYIDABCDE","typ":"JWT"},
 *   )
 *   # token is non-deterministic in the signature segment; the first two
 *   # segments are stable. The test verifies them byte-for-byte and proves
 *   # the signature with the matching public key.
 */

import { assert, assertEquals } from "@std/assert";
import {
  _resetApnsJwtCache,
  type ApnsTarget,
  getApnsJwt,
  renderApnsBody,
  sendApns,
  signApnsJwt,
} from "./apns.ts";

// ---------------------------------------------------------------------------
// Fixed test vectors
// ---------------------------------------------------------------------------

/** Throwaway P-256 P8 key generated for tests only. Never used in production. */
const TEST_P8_PEM = [
  "-----BEGIN PRIVATE KEY-----",
  "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgqc4e19eOunAhkgvQ",
  "FpQfHD1/FUmy2+AmzvX+dCh2FUahRANCAASq30dR/2eKmb/9T5x31XrPdtqCbI1y",
  "ZHJsXOAbSb6xEabK7hvJS1Ocvz5uiKWQ1ceWzj+XwuZ5pj0e3CBhp7OS",
  "-----END PRIVATE KEY-----",
].join("\n");

/** Public key matching `TEST_P8_PEM`. Used to verify ECDSA signatures. */
const TEST_PUB_PEM = [
  "-----BEGIN PUBLIC KEY-----",
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEqt9HUf9nipm//U+cd9V6z3bagmyN",
  "cmRybFzgG0m+sRGmyu4byUtTnL8+boilkNXHls4/l8LmeaY9HtwgYaezkg==",
  "-----END PUBLIC KEY-----",
].join("\n");

const TEST_P8_BASE64 = btoa(TEST_P8_PEM);

const TEST_KEY_ID = "KEYIDABCDE";
const TEST_TEAM_ID = "TEAMID9999";
const TEST_IAT = 1_745_600_000;

/** Expected header segment for `{alg:"ES256",kid:"KEYIDABCDE",typ:"JWT"}`. */
const EXPECTED_HEADER_SEG =
  "eyJhbGciOiJFUzI1NiIsImtpZCI6IktFWUlEQUJDREUiLCJ0eXAiOiJKV1QifQ";
/** Expected claims segment for `{iss:"TEAMID9999",iat:1745600000}`. */
const EXPECTED_CLAIMS_SEG =
  "eyJpc3MiOiJURUFNSUQ5OTk5IiwiaWF0IjoxNzQ1NjAwMDAwfQ";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function base64UrlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importTestPubKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "spki",
    pemToDer(TEST_PUB_PEM),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

/** Set the four APNs env vars for the duration of `fn`, then restore. */
async function withApnsEnv<T>(
  vars: Partial<{
    APNS_KEY_ID: string;
    APNS_TEAM_ID: string;
    APNS_KEY_BASE64: string;
    APNS_TOPIC: string;
  }>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    previous[k] = Deno.env.get(k);
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

// ---------------------------------------------------------------------------
// JWT signer tests
// ---------------------------------------------------------------------------

Deno.test("signApnsJwt — header & claims segments match expected vectors", async () => {
  const token = await signApnsJwt({
    keyId: TEST_KEY_ID,
    teamId: TEST_TEAM_ID,
    keyBase64: TEST_P8_BASE64,
    iatSec: TEST_IAT,
  });
  const [headerSeg, claimsSeg, sigSeg] = token.split(".");
  assertEquals(headerSeg, EXPECTED_HEADER_SEG);
  assertEquals(claimsSeg, EXPECTED_CLAIMS_SEG);
  assert(sigSeg.length > 0, "signature segment must be non-empty");
});

Deno.test("signApnsJwt — signature verifies against matching public key", async () => {
  const token = await signApnsJwt({
    keyId: TEST_KEY_ID,
    teamId: TEST_TEAM_ID,
    keyBase64: TEST_P8_BASE64,
    iatSec: TEST_IAT,
  });
  const [headerSeg, claimsSeg, sigSeg] = token.split(".");
  const pub = await importTestPubKey();
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    pub,
    base64UrlDecode(sigSeg) as BufferSource,
    new TextEncoder().encode(`${headerSeg}.${claimsSeg}`),
  );
  assert(ok, "ES256 signature must verify against the matching public key");
});

Deno.test("signApnsJwt — rejects empty key/team/keyBase64", async () => {
  let threw = 0;
  for (
    const inputs of [
      { keyId: "", teamId: "x", keyBase64: "x", iatSec: 1 },
      { keyId: "x", teamId: "", keyBase64: "x", iatSec: 1 },
      { keyId: "x", teamId: "x", keyBase64: "", iatSec: 1 },
    ]
  ) {
    try {
      await signApnsJwt(inputs);
    } catch {
      threw++;
    }
  }
  assertEquals(threw, 3, "missing inputs must each throw");
});

Deno.test("getApnsJwt — caches within 50-minute window", async () => {
  await withApnsEnv(
    {
      APNS_KEY_ID: TEST_KEY_ID,
      APNS_TEAM_ID: TEST_TEAM_ID,
      APNS_KEY_BASE64: TEST_P8_BASE64,
    },
    async () => {
      _resetApnsJwtCache();
      const t0 = 1_745_600_000_000;
      const a = await getApnsJwt(t0);
      const b = await getApnsJwt(t0 + 30 * 60 * 1000); // +30min: still cached
      assertEquals(a, b, "JWT should be reused within the 50-min window");

      // Past 50min: cache invalidates and we get a fresh signing. The new
      // token will differ in the iat claim (+ random ECDSA signature), so
      // segment 2 changes — that's a sufficient signal of re-sign.
      const c = await getApnsJwt(t0 + 51 * 60 * 1000);
      const aClaims = a.split(".")[1];
      const cClaims = c.split(".")[1];
      assert(
        aClaims !== cClaims,
        "cache should expire past 50min and re-sign with a fresh iat",
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Body rendering test
// ---------------------------------------------------------------------------

Deno.test("renderApnsBody — matches canonical 20-contracts shape", () => {
  const body = renderApnsBody({
    alert: { title: "Scan a card now", body: "Tap to start the NFC scan" },
    threadId: "device-scan-DEV1",
    interruptionLevel: "time-sensitive",
    custom: {
      deviceId: "DEV1",
      pairingCode: "X7R2KQ",
      purpose: "admin-link",
      hintLabel: "Front desk",
      expiresAtEpochMs: 1_745_622_090_000,
    },
  });
  assertEquals(body, {
    aps: {
      alert: { title: "Scan a card now", body: "Tap to start the NFC scan" },
      sound: "default",
      category: "NFC_SCAN_REQUEST",
      "thread-id": "device-scan-DEV1",
      "interruption-level": "time-sensitive",
      "mutable-content": 1,
    },
    v: 1,
    deviceId: "DEV1",
    pairingCode: "X7R2KQ",
    purpose: "admin-link",
    hintLabel: "Front desk",
    expiresAtEpochMs: 1_745_622_090_000,
  });
});

// ---------------------------------------------------------------------------
// HTTP client tests (stubbed fetch)
// ---------------------------------------------------------------------------

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Replace globalThis.fetch with a stub that captures requests and returns
 * the caller-supplied response. Returns a restore function.
 */
function stubFetch(
  handler: (req: Request) => Promise<Response> | Response,
): { captured: CapturedRequest[]; restore: () => void } {
  const captured: CapturedRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const req = input instanceof Request
      ? input
      : new Request(input.toString(), init);
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    let body: unknown = null;
    const text = await req.clone().text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    captured.push({ url: req.url, method: req.method, headers, body });
    return await handler(req);
  };
  return {
    captured,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

Deno.test("sendApns — sends canonical headers + body to production host", async () => {
  await withApnsEnv(
    {
      APNS_KEY_ID: TEST_KEY_ID,
      APNS_TEAM_ID: TEST_TEAM_ID,
      APNS_KEY_BASE64: TEST_P8_BASE64,
      APNS_TOPIC: "gg.vlad.expresscan",
    },
    async () => {
      _resetApnsJwtCache();
      const { captured, restore } = stubFetch(
        () => new Response("", { status: 200 }),
      );
      try {
        const target: ApnsTarget = {
          pushToken: "abc123hex",
          environment: "production",
        };
        const result = await sendApns(target, {
          alert: {
            title: "Scan a card now",
            body: "Tap to start the NFC scan",
          },
          threadId: "device-scan-DEV1",
          collapseId: "scan-X7R2KQ",
          expirationEpochSec: 1_745_622_090,
          interruptionLevel: "time-sensitive",
          custom: {
            deviceId: "DEV1",
            pairingCode: "X7R2KQ",
            purpose: "admin-link",
            hintLabel: "Front desk",
            expiresAtEpochMs: 1_745_622_090_000,
          },
        });
        assertEquals(result, { ok: true });
        assertEquals(captured.length, 1);
        const req = captured[0];
        assertEquals(
          req.url,
          "https://api.push.apple.com/3/device/abc123hex",
        );
        assertEquals(req.method, "POST");
        assertEquals(req.headers["apns-topic"], "gg.vlad.expresscan");
        assertEquals(req.headers["apns-priority"], "10");
        assertEquals(req.headers["apns-push-type"], "alert");
        assertEquals(req.headers["apns-expiration"], "1745622090");
        assertEquals(req.headers["apns-collapse-id"], "scan-X7R2KQ");
        assertEquals(req.headers["content-type"], "application/json");
        const auth = req.headers["authorization"];
        assert(
          auth.startsWith("bearer "),
          `authorization must start with 'bearer ', got: ${auth}`,
        );
        // JWT has 3 dot-segments and the header segment matches our vector.
        const jwt = auth.slice("bearer ".length);
        const [headerSeg] = jwt.split(".");
        assertEquals(headerSeg, EXPECTED_HEADER_SEG);
        // Body shape — canonical aps + top-level custom keys.
        assertEquals(req.body, {
          aps: {
            alert: {
              title: "Scan a card now",
              body: "Tap to start the NFC scan",
            },
            sound: "default",
            category: "NFC_SCAN_REQUEST",
            "thread-id": "device-scan-DEV1",
            "interruption-level": "time-sensitive",
            "mutable-content": 1,
          },
          v: 1,
          deviceId: "DEV1",
          pairingCode: "X7R2KQ",
          purpose: "admin-link",
          hintLabel: "Front desk",
          expiresAtEpochMs: 1_745_622_090_000,
        });
      } finally {
        restore();
      }
    },
  );
});

Deno.test("sendApns — sandbox environment hits sandbox host", async () => {
  await withApnsEnv(
    {
      APNS_KEY_ID: TEST_KEY_ID,
      APNS_TEAM_ID: TEST_TEAM_ID,
      APNS_KEY_BASE64: TEST_P8_BASE64,
    },
    async () => {
      _resetApnsJwtCache();
      const { captured, restore } = stubFetch(
        () => new Response("", { status: 200 }),
      );
      try {
        await sendApns(
          { pushToken: "tok", environment: "sandbox" },
          { alert: { title: "t", body: "b" } },
        );
        assertEquals(
          captured[0].url,
          "https://api.sandbox.push.apple.com/3/device/tok",
        );
        // No collapseId / expiration provided → header defaults.
        assertEquals(captured[0].headers["apns-expiration"], "0");
        assertEquals(captured[0].headers["apns-collapse-id"], undefined);
      } finally {
        restore();
      }
    },
  );
});

Deno.test("sendApns — propagates APNs reason on rejection", async () => {
  await withApnsEnv(
    {
      APNS_KEY_ID: TEST_KEY_ID,
      APNS_TEAM_ID: TEST_TEAM_ID,
      APNS_KEY_BASE64: TEST_P8_BASE64,
    },
    async () => {
      _resetApnsJwtCache();
      const { restore } = stubFetch(
        () =>
          new Response(JSON.stringify({ reason: "BadDeviceToken" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
      );
      try {
        const result = await sendApns(
          { pushToken: "tok", environment: "production" },
          { alert: { title: "t", body: "b" } },
        );
        assertEquals(result, {
          ok: false,
          status: 400,
          reason: "BadDeviceToken",
        });
      } finally {
        restore();
      }
    },
  );
});

Deno.test("sendApns — reuses JWT across sends inside the 50-min window", async () => {
  await withApnsEnv(
    {
      APNS_KEY_ID: TEST_KEY_ID,
      APNS_TEAM_ID: TEST_TEAM_ID,
      APNS_KEY_BASE64: TEST_P8_BASE64,
    },
    async () => {
      _resetApnsJwtCache();
      const { captured, restore } = stubFetch(
        () => new Response("", { status: 200 }),
      );
      try {
        await sendApns(
          { pushToken: "t1", environment: "production" },
          { alert: { title: "t", body: "b" } },
        );
        await sendApns(
          { pushToken: "t2", environment: "production" },
          { alert: { title: "t", body: "b" } },
        );
        assertEquals(captured.length, 2);
        // Same authorization header → JWT was reused (the cache is the only
        // way this test could see identical auth headers across two sends,
        // because each fresh signApnsJwt call has a different ECDSA
        // signature segment).
        assertEquals(
          captured[0].headers["authorization"],
          captured[1].headers["authorization"],
          "JWT should be reused inside the 50-min window",
        );
      } finally {
        restore();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Live-server smoke (Deno.serve) — exercises the real fetch path end-to-end
// against a local listener. Not a substitute for the stubFetch tests (those
// can intercept without --allow-net), but proves the fetch wiring works
// when net is available.
// ---------------------------------------------------------------------------

Deno.test({
  name: "sendApns — live Deno.serve listener round-trip",
  // Requires --allow-net for both serve + fetch. Skipped if not granted.
  ignore: !(await hasNetPermission()),
  fn: async () => {
    await withApnsEnv(
      {
        APNS_KEY_ID: TEST_KEY_ID,
        APNS_TEAM_ID: TEST_TEAM_ID,
        APNS_KEY_BASE64: TEST_P8_BASE64,
        APNS_TOPIC: "gg.vlad.expresscan",
      },
      async () => {
        _resetApnsJwtCache();
        let captured: CapturedRequest | null = null;
        const ac = new AbortController();
        const server = Deno.serve(
          { port: 0, hostname: "127.0.0.1", signal: ac.signal },
          async (req) => {
            const headers: Record<string, string> = {};
            req.headers.forEach((v, k) => {
              headers[k.toLowerCase()] = v;
            });
            const text = await req.text();
            captured = {
              url: req.url,
              method: req.method,
              headers,
              body: text ? JSON.parse(text) : null,
            };
            return new Response("", { status: 200 });
          },
        );
        try {
          // Redirect Deno's fetch by patching the URL host inside sendApns
          // would require an internal seam we don't want. Instead we
          // monkey-patch fetch to route api.push.apple.com → our listener.
          const original = globalThis.fetch;
          const port = server.addr.port;
          globalThis.fetch = (input, init) => {
            const url = typeof input === "string"
              ? input
              : input instanceof URL
              ? input.toString()
              : input.url;
            const rewritten = url.replace(
              /^https:\/\/api\.push\.apple\.com/,
              `http://127.0.0.1:${port}`,
            );
            return original(rewritten, init);
          };
          try {
            const result = await sendApns(
              { pushToken: "live123", environment: "production" },
              {
                alert: { title: "Live", body: "Roundtrip" },
                interruptionLevel: "time-sensitive",
                threadId: "device-scan-LIVE",
              },
            );
            assertEquals(result, { ok: true });
            assert(captured !== null, "server should have observed a request");
            const got = captured as unknown as CapturedRequest;
            assertEquals(got.method, "POST");
            assertEquals(got.headers["apns-topic"], "gg.vlad.expresscan");
            assert(got.headers["authorization"].startsWith("bearer "));
            assertEquals(
              (got.body as { v: number }).v,
              1,
              "body must include v:1",
            );
          } finally {
            globalThis.fetch = original;
          }
        } finally {
          ac.abort();
          await server.finished.catch(() => {});
        }
      },
    );
  },
});

async function hasNetPermission(): Promise<boolean> {
  try {
    const status = await Deno.permissions.query({ name: "net" });
    return status.state === "granted";
  } catch {
    return false;
  }
}

/**
 * ExpresScan / Wave 2 Track B-lifecycle — registration helper unit tests.
 *
 * Pure-crypto coverage of:
 *   - PKCE encoding correctness (`sha256Base64Url` vs known vectors)
 *   - base64url alphabet (no `+/=`)
 *   - constant-time compare semantics
 *   - device-credential shape + uniqueness
 *
 * DB-bound functions (`mintOneTimeCode`, `claimOneTimeCode`) are exercised
 * indirectly via the register handler tests — the unit test here would
 * require a running Postgres. We instead lock in the cryptographic
 * primitives so a regression in the encoder can't slip past CI.
 *
 * `sanitizeResources` is disabled because importing `registration.ts`
 * pulls in the postgres client (via `db/index.ts`) which holds a pool
 * even when no query runs.
 */

import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  base64UrlEncode,
  constantTimeEqual,
  generateDeviceCredentials,
  sha256Base64Url,
} from "./registration.ts";

// ============================================================================
// base64UrlEncode — alphabet correctness
// ============================================================================

Deno.test({
  name: "base64UrlEncode — uses base64url alphabet (no +, /, =)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    // Bytes that produce '+', '/', '=' in classic base64.
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0xff]);
    const encoded = base64UrlEncode(bytes);
    assert(!encoded.includes("+"), "must not contain '+'");
    assert(!encoded.includes("/"), "must not contain '/'");
    assert(!encoded.includes("="), "must not contain '=' (no padding)");
  },
});

Deno.test({
  name: "base64UrlEncode — round-trip-stable for empty input",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    assertEquals(base64UrlEncode(new Uint8Array(0)), "");
  },
});

Deno.test({
  name: "base64UrlEncode — produces deterministic output",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const a = base64UrlEncode(bytes);
    const b = base64UrlEncode(bytes);
    assertEquals(a, b);
  },
});

// ============================================================================
// sha256Base64Url — known vectors
// ============================================================================

Deno.test({
  name: "sha256Base64Url — matches known SHA256 vector",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    // base64url (no padding): ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0
    const result = await sha256Base64Url("abc");
    assertEquals(result, "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  },
});

Deno.test({
  name: "sha256Base64Url — empty input matches known SHA256 vector",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const result = await sha256Base64Url("");
    assertEquals(result, "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
  },
});

Deno.test({
  name: "sha256Base64Url — different inputs produce different outputs",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const a = await sha256Base64Url(
      "verifier-a-12345678901234567890123456789012345",
    );
    const b = await sha256Base64Url(
      "verifier-b-12345678901234567890123456789012345",
    );
    assertNotEquals(a, b);
  },
});

// ============================================================================
// constantTimeEqual — semantics (not actual timing)
// ============================================================================

Deno.test({
  name: "constantTimeEqual — equal strings return true",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    assert(constantTimeEqual("hello", "hello"));
  },
});

Deno.test({
  name: "constantTimeEqual — unequal strings return false",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    assert(!constantTimeEqual("hello", "world"));
  },
});

Deno.test({
  name: "constantTimeEqual — length mismatch returns false",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    assert(!constantTimeEqual("hello", "helloo"));
  },
});

Deno.test({
  name: "constantTimeEqual — empty strings",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: () => {
    assert(constantTimeEqual("", ""));
  },
});

// ============================================================================
// generateDeviceCredentials — shape + uniqueness
// ============================================================================

Deno.test({
  name: "generateDeviceCredentials — token has 'dev_' prefix",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const c = await generateDeviceCredentials();
    assert(c.deviceToken.startsWith("dev_"));
  },
});

Deno.test({
  name: "generateDeviceCredentials — token uses base64url alphabet (no +,/,=)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const c = await generateDeviceCredentials();
    const body = c.deviceToken.slice("dev_".length);
    assert(
      /^[A-Za-z0-9_-]+$/.test(body),
      `unexpected chars in token body: ${body}`,
    );
  },
});

Deno.test({
  name: "generateDeviceCredentials — secret uses base64url alphabet",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const c = await generateDeviceCredentials();
    assert(/^[A-Za-z0-9_-]+$/.test(c.deviceSecret));
  },
});

Deno.test({
  name: "generateDeviceCredentials — token + secret are unique per call",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const a = await generateDeviceCredentials();
    const b = await generateDeviceCredentials();
    assertNotEquals(a.deviceToken, b.deviceToken);
    assertNotEquals(a.deviceSecret, b.deviceSecret);
    assertNotEquals(a.deviceTokenHash, b.deviceTokenHash);
  },
});

Deno.test({
  name: "generateDeviceCredentials — token hash is 64-hex (sha256), secret is base64url",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const c = await generateDeviceCredentials();
    assertEquals(c.deviceTokenHash.length, 64);
    assert(/^[0-9a-f]{64}$/.test(c.deviceTokenHash));
    // deviceSecret is raw 32 bytes base64url-encoded (no padding) → 43 chars.
    assertEquals(c.deviceSecret.length, 43);
    assert(/^[A-Za-z0-9_-]{43}$/.test(c.deviceSecret));
  },
});

Deno.test({
  name: "generateDeviceCredentials — hash matches sha256 of raw value",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const c = await generateDeviceCredentials();
    const expectedHash = await (async () => {
      const buf = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(c.deviceToken),
      );
      return [...new Uint8Array(buf)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    })();
    assertEquals(c.deviceTokenHash, expectedHash);
  },
});

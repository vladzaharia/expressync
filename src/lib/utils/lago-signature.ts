/**
 * Verify a Lago webhook signature.
 *
 * Lago signs each webhook with its RSA private key (RS256 JWT) and places
 * the JWT in the `X-Lago-Signature` header. The public key is served at
 * `GET /api/v1/webhooks/public_key` (base64-encoded PEM). Verification proves
 * the request came from Lago; a valid signature is treated as authoritative.
 *
 * This module implements the verify step with the Web Crypto API so we don't
 * pull in an extra JWT library.
 */

import { logger } from "./logger.ts";

const log = logger.child("LagoSignature");

/** Cache: PEM string we last imported, keyed by PEM contents. */
const keyCache = new Map<string, CryptoKey>();

function base64UrlDecodeToBytes(s: string): Uint8Array<ArrayBuffer> {
  // base64url → base64 (swap chars, pad)
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function importPublicKey(pem: string): Promise<CryptoKey> {
  const cached = keyCache.get(pem);
  if (cached) return cached;
  const key = await crypto.subtle.importKey(
    "spki",
    pemToDer(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  keyCache.set(pem, key);
  return key;
}

/**
 * Verify the `X-Lago-Signature` JWT against the given PEM public key.
 *
 * Returns `true` iff the JWT parses, declares `alg=RS256`, and the signature
 * verifies against the key. We do not enforce claims (iss/exp) — Lago's JWT
 * payload is primarily a proof-of-origin, not a session token.
 */
export async function verifyLagoSignature(
  jwt: string,
  publicKeyPem: string,
): Promise<boolean> {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    log.warn("Malformed signature (expected 3 JWT parts)");
    return false;
  }
  const [headerB64, payloadB64, sigB64] = parts;

  let headerJson: unknown;
  try {
    headerJson = JSON.parse(new TextDecoder().decode(
      base64UrlDecodeToBytes(headerB64),
    ));
  } catch (err) {
    log.warn("Failed to decode JWT header", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
  const alg = (headerJson as { alg?: unknown }).alg;
  if (alg !== "RS256") {
    log.warn("Unexpected JWT alg", { alg });
    return false;
  }

  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecodeToBytes(sigB64);
  let key: CryptoKey;
  try {
    key = await importPublicKey(publicKeyPem);
  } catch (err) {
    log.error("Failed to import Lago webhook public key", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }

  try {
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature,
      signingInput,
    );
  } catch (err) {
    log.warn("JWT verify threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Polaris Express Email Worker.
 *
 * Receives HMAC-signed POST /send requests from the Fresh app and forwards
 * them to Cloudflare Email Service via the `send_email` binding.
 *
 * Contract (see ../../README.md and the customer-portal plan for full spec):
 *
 *   POST /send
 *   X-Polaris-Sig: HMAC-SHA256(SHARED_SECRET, body) — hex-encoded
 *   Content-Type: application/json
 *   Body: {
 *     ts: number,                          // epoch millis
 *     nonce: string,                       // base64url-16-bytes (idempotency key)
 *     to: string,                          // recipient email
 *     subject: string,
 *     html: string,
 *     text: string,
 *     category: string,                    // "magic-link" | "session-summary" | ...
 *     from?: string,                       // RFC 5322 from header
 *     replyTo?: string,
 *     headers?: Record<string, string>     // e.g. List-Unsubscribe
 *   }
 *
 * Validation pipeline (any failure → 4xx, no email sent):
 *   1. HMAC verify in constant time via crypto.subtle.verify (against either
 *      POLARIS_SECRET_A or POLARIS_SECRET_B, supporting zero-downtime rotation).
 *   2. Reject if |now - ts| > TS_WINDOW_MS (default 5 min).
 *   3. Reject if nonce seen in KV within NONCE_TTL_SECONDS (replay defense).
 *   4. Per-recipient rate limit: ≤ RATE_LIMIT_MAX per RATE_LIMIT_WINDOW_SECONDS
 *      keyed by sha256(`${to}:${category}`).
 *   5. `from:` allowlist — must match one of our two configured senders.
 *
 * Logging — NEVER log payload bodies in plaintext. Only sha256-hashed
 * recipient + category + ts + nonce_hash, so we can correlate operations
 * without exposing user PII or message content.
 */

export interface Env {
  // Cloudflare Email Service bindings — one per allowed sender.
  EMAIL_NOREPLY: SendEmailBinding;
  EMAIL_ADMIN_NOREPLY: SendEmailBinding;

  // Shared KV for nonce dedup + rate limits.
  EMAIL_NONCE_DEDUP: KVNamespace;

  // Two-secret rolling rotation. POLARIS_SECRET_B is optional.
  POLARIS_SECRET_A: string;
  POLARIS_SECRET_B?: string;

  // Vars from wrangler.jsonc.
  DEFAULT_REPLY_TO: string;
  RATE_LIMIT_MAX: string;
  RATE_LIMIT_WINDOW_SECONDS: string;
  TS_WINDOW_MS: string;
  NONCE_TTL_SECONDS: string;
}

// Cloudflare's send_email binding shape (only the bits we use).
interface SendEmailBinding {
  send(message: {
    to: string | string[];
    from: string;
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string;
    headers?: Record<string, string>;
  }): Promise<void>;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

// ---- Sender allowlist (defense-in-depth vs HMAC compromise) ----------------

const ALLOWED_SENDER_ADDRESSES = new Set([
  "noreply@polaris.express",
  "admin-noreply@polaris.express",
]);

function pickBindingForSender(
  env: Env,
  fromAddress: string,
): SendEmailBinding | null {
  switch (fromAddress) {
    case "noreply@polaris.express":
      return env.EMAIL_NOREPLY;
    case "admin-noreply@polaris.express":
      return env.EMAIL_ADMIN_NOREPLY;
    default:
      return null;
  }
}

// ---- Helpers ---------------------------------------------------------------

const textEncoder = new TextEncoder();

/** Parse a `Display Name <addr@example>` header and return the bare address. */
function extractAddress(header: string): string {
  const match = header.match(/<([^>]+)>/);
  return (match ? match[1] : header).trim().toLowerCase();
}

function hexDecode(hex: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function hexEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < view.length; i++) {
    s += view[i].toString(16).padStart(2, "0");
  }
  return s;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(input),
  );
  return hexEncode(digest);
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

/**
 * Constant-time HMAC verify against a list of candidate secrets. Returns true
 * if ANY candidate matches. Each verify call uses crypto.subtle.verify, which
 * compares hashes in constant time internally.
 */
async function verifyHmac(
  secrets: string[],
  body: string,
  signatureHex: string,
): Promise<boolean> {
  const sig = hexDecode(signatureHex);
  if (!sig) return false;
  const data = textEncoder.encode(body);
  let ok = false;
  for (const secret of secrets) {
    if (!secret) continue;
    try {
      const key = await importHmacKey(secret);
      if (await crypto.subtle.verify("HMAC", key, sig, data)) {
        ok = true;
        // Don't early-return: keep iterating so timing leaks the count of
        // configured secrets, not which one matched.
      }
    } catch {
      // Swallow — bad secret material shouldn't blow up the request.
    }
  }
  return ok;
}

interface RatePayload {
  count: number;
  windowStart: number;
}

/**
 * Sliding-window rate limit (fixed-window approximation backed by KV).
 *
 * The rate-limit key is sha256(`${to}:${category}`) so we never store the
 * recipient address in plaintext in KV, even momentarily.
 *
 * Returns true if the request is allowed, false if it would exceed the limit.
 */
async function checkRateLimit(
  env: Env,
  to: string,
  category: string,
): Promise<boolean> {
  const max = parseInt(env.RATE_LIMIT_MAX) || 5;
  const windowSeconds = parseInt(env.RATE_LIMIT_WINDOW_SECONDS) || 600;
  const keyHash = await sha256Hex(`${to.toLowerCase()}:${category}`);
  const key = `rl:${keyHash}`;
  const now = Date.now();

  let payload: RatePayload | null = null;
  const existing = await env.EMAIL_NONCE_DEDUP.get(key);
  if (existing) {
    try {
      payload = JSON.parse(existing) as RatePayload;
    } catch {
      payload = null;
    }
  }

  const windowMs = windowSeconds * 1000;
  if (payload && now - payload.windowStart < windowMs) {
    if (payload.count >= max) return false;
    payload.count += 1;
  } else {
    payload = { count: 1, windowStart: now };
  }

  await env.EMAIL_NONCE_DEDUP.put(key, JSON.stringify(payload), {
    expirationTtl: windowSeconds,
  });
  return true;
}

// ---- Request body shape ----------------------------------------------------

interface SendBody {
  ts: unknown;
  nonce: unknown;
  to: unknown;
  subject: unknown;
  html: unknown;
  text: unknown;
  category: unknown;
  from?: unknown;
  replyTo?: unknown;
  headers?: unknown;
}

interface ValidatedBody {
  ts: number;
  nonce: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  category: string;
  from: string;
  replyTo: string;
  headers?: Record<string, string>;
}

const ALLOWED_CATEGORIES = new Set([
  "magic-link",
  "welcome",
  "session-summary",
  "reservation-cancelled",
  "account-reactivated",
  "admin-password-reset",
  "invoice-available",
  "account-inactive",
]);

function validateBody(
  body: SendBody,
  defaultReplyTo: string,
): { ok: true; value: ValidatedBody } | { ok: false; error: string } {
  if (typeof body.ts !== "number" || !Number.isFinite(body.ts)) {
    return { ok: false, error: "ts must be a number" };
  }
  if (typeof body.nonce !== "string" || body.nonce.length < 8) {
    return { ok: false, error: "nonce must be a string ≥ 8 chars" };
  }
  if (typeof body.to !== "string" || !body.to.includes("@")) {
    return { ok: false, error: "to must be a valid email" };
  }
  if (typeof body.subject !== "string" || body.subject.length === 0) {
    return { ok: false, error: "subject required" };
  }
  if (typeof body.html !== "string" || body.html.length === 0) {
    return { ok: false, error: "html required" };
  }
  if (typeof body.text !== "string" || body.text.length === 0) {
    return { ok: false, error: "text required" };
  }
  if (typeof body.category !== "string" || !ALLOWED_CATEGORIES.has(body.category)) {
    return { ok: false, error: "unknown category" };
  }

  const fromHeader = typeof body.from === "string" && body.from.length > 0
    ? body.from
    : "ExpressCharge <noreply@polaris.express>";
  const fromAddr = extractAddress(fromHeader);
  if (!ALLOWED_SENDER_ADDRESSES.has(fromAddr)) {
    return { ok: false, error: `sender ${fromAddr} not allowlisted` };
  }

  const replyTo = typeof body.replyTo === "string" && body.replyTo.length > 0
    ? body.replyTo
    : defaultReplyTo;

  let headers: Record<string, string> | undefined;
  if (body.headers && typeof body.headers === "object") {
    headers = {};
    for (const [k, v] of Object.entries(body.headers)) {
      if (typeof v === "string") headers[k] = v;
    }
  }

  return {
    ok: true,
    value: {
      ts: body.ts,
      nonce: body.nonce,
      to: body.to,
      subject: body.subject,
      html: body.html,
      text: body.text,
      category: body.category,
      from: fromHeader,
      replyTo,
      headers,
    },
  };
}

// ---- Worker entry ----------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse({ ok: true });
    }

    if (url.pathname !== "/send") {
      return jsonResponse({ error: "not found" }, 404);
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "method not allowed" }, 405);
    }

    // Read raw body once — needed both for signature verification and JSON parse.
    let raw: string;
    try {
      raw = await request.text();
    } catch {
      return jsonResponse({ error: "invalid body" }, 400);
    }
    if (raw.length === 0 || raw.length > 256 * 1024) {
      return jsonResponse({ error: "body too large or empty" }, 400);
    }

    const sig = request.headers.get("x-polaris-sig") ?? "";
    if (!sig) return jsonResponse({ error: "missing signature" }, 401);

    const secrets = [env.POLARIS_SECRET_A, env.POLARIS_SECRET_B].filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
    if (secrets.length === 0) {
      console.error(JSON.stringify({
        level: "ERROR",
        category: "EmailWorker",
        message: "no signing secrets configured",
      }));
      return jsonResponse({ error: "server misconfigured" }, 500);
    }
    if (!await verifyHmac(secrets, raw, sig)) {
      return jsonResponse({ error: "bad signature" }, 401);
    }

    let parsed: SendBody;
    try {
      parsed = JSON.parse(raw) as SendBody;
    } catch {
      return jsonResponse({ error: "invalid json" }, 400);
    }

    const validation = validateBody(parsed, env.DEFAULT_REPLY_TO);
    if (!validation.ok) {
      return jsonResponse({ error: validation.error }, 400);
    }
    const v = validation.value;

    // Step 2: timestamp window.
    const tsWindow = parseInt(env.TS_WINDOW_MS) || 5 * 60 * 1000;
    if (Math.abs(Date.now() - v.ts) > tsWindow) {
      return jsonResponse({ error: "stale or future timestamp" }, 401);
    }

    // Compute privacy-preserving log fields up-front so we can log on every
    // path (success and rejection).
    const [toHash, nonceHash] = await Promise.all([
      sha256Hex(v.to.toLowerCase()),
      sha256Hex(v.nonce),
    ]);
    // Privacy-preserving log fields. We rename `category` to
    // `email_category` so it doesn't collide with the logger envelope's
    // own `category` field (which is always "EmailWorker").
    const logCtx = {
      to_hash: toHash,
      email_category: v.category,
      ts: v.ts,
      nonce_hash: nonceHash,
    };

    // Step 3: nonce dedup — atomic-ish via "if absent" semantics. KV doesn't
    // give us true CAS, but reading + writing within a single request handler
    // is good enough for replay defense (worst case: same nonce slips through
    // twice if two requests race; the rate limit catches that).
    const nonceTtl = parseInt(env.NONCE_TTL_SECONDS) || 600;
    const nonceKey = `nonce:${nonceHash}`;
    const seen = await env.EMAIL_NONCE_DEDUP.get(nonceKey);
    if (seen) {
      console.warn(JSON.stringify({
        level: "WARN",
        category: "EmailWorker",
        message: "nonce reuse rejected",
        ...logCtx,
      }));
      return jsonResponse({ error: "nonce reuse" }, 401);
    }
    await env.EMAIL_NONCE_DEDUP.put(nonceKey, "1", {
      expirationTtl: nonceTtl,
    });

    // Step 4: per-recipient rate limit.
    if (!await checkRateLimit(env, v.to, v.category)) {
      console.warn(JSON.stringify({
        level: "WARN",
        category: "EmailWorker",
        message: "rate limit exceeded",
        ...logCtx,
      }));
      return jsonResponse({ error: "rate limited" }, 429);
    }

    // Step 5: send via the matching binding.
    const fromAddr = extractAddress(v.from);
    const binding = pickBindingForSender(env, fromAddr);
    if (!binding) {
      // validateBody already checks the allowlist, but be defensive.
      return jsonResponse({ error: "no binding for sender" }, 400);
    }

    try {
      await binding.send({
        to: [v.to],
        from: v.from,
        subject: v.subject,
        html: v.html,
        text: v.text,
        replyTo: v.replyTo,
        headers: v.headers,
      });
    } catch (err) {
      console.error(JSON.stringify({
        level: "ERROR",
        category: "EmailWorker",
        message: "send failed",
        ...logCtx,
        error: err instanceof Error ? err.message : String(err),
      }));
      return jsonResponse({ error: "send failed" }, 502);
    }

    console.log(JSON.stringify({
      level: "INFO",
      category: "EmailWorker",
      message: "send ok",
      ...logCtx,
    }));
    return jsonResponse({ ok: true });
  },
};

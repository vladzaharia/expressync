/**
 * Idempotency-Key middleware helper.
 *
 * Endpoints opt in by wrapping their handler in `withIdempotency(ctx, route, fn)`.
 * Behavior:
 *
 *   - No `Idempotency-Key` header? Run `fn()` and return its Response
 *     untouched. Existing call-sites are unaffected.
 *   - Header present + matching row in `idempotency_keys` (same key, same
 *     route, same userId)? Return the cached status + body — no re-run.
 *   - Header present, no row? Run `fn()`, capture status + body, INSERT a
 *     new row, return the original response.
 *
 * `userId` is derived from `ctx.state.user?.id` and stored alongside the key
 * so two callers can never collide on a key (a malicious customer can't
 * replay an admin's idempotency key against an admin endpoint).
 *
 * Cleanup: `pruneExpiredIdempotencyKeys()` deletes rows older than 24h. The
 * sync-worker's existing 2-minute housekeeping cron is the natural caller.
 */

import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { idempotencyKeys } from "../db/schema.ts";
import { logger } from "./utils/logger.ts";
import type { State } from "../../utils.ts";

const log = logger.child("Idempotency");

/** Rows older than this are eligible for cleanup. */
const TTL_MS = 24 * 60 * 60 * 1000;

interface IdempotencyContext {
  req: Request;
  state: State;
}

/**
 * Run `fn` under idempotency protection if the request carries an
 * `Idempotency-Key` header.
 *
 * The cached body is JSON-encoded — non-JSON responses (e.g. binary
 * streams) bypass caching and are passed through unmodified. State-changing
 * endpoints in this service all return JSON, so the cost is acceptable.
 */
export async function withIdempotency(
  ctx: IdempotencyContext,
  route: string,
  fn: () => Promise<Response>,
): Promise<Response> {
  const key = ctx.req.headers.get("Idempotency-Key");
  if (!key || key.trim() === "") {
    return await fn();
  }
  const trimmed = key.trim();
  // Reject pathologically large keys to avoid blowing up the index.
  if (trimmed.length > 200) {
    return new Response(
      JSON.stringify({ error: "idempotency_key_too_long" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const userId = ctx.state.user?.id ?? null;

  // Lookup. We compare userId via a SQL-level NULL-safe equality so the
  // anonymous case (userId = NULL) still matches a previously stored
  // anonymous row.
  let cached: typeof idempotencyKeys.$inferSelect | undefined;
  try {
    const rows = await db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, trimmed))
      .limit(1);
    cached = rows[0];
  } catch (err) {
    log.error("Lookup failed; proceeding without cache", {
      error: err instanceof Error ? err.message : String(err),
    });
    return await fn();
  }

  if (cached) {
    if (cached.route !== route) {
      // Key reuse across routes is a programming error from the client.
      return new Response(
        JSON.stringify({ error: "idempotency_key_route_mismatch" }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }
    if ((cached.userId ?? null) !== userId) {
      // Different user replaying somebody else's key — refuse.
      return new Response(
        JSON.stringify({ error: "idempotency_key_owner_mismatch" }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(cached.responseBody), {
      status: cached.responseStatus,
      headers: { "Content-Type": "application/json" },
    });
  }

  // No cached row — execute and capture.
  const response = await fn();

  // We only cache JSON responses. Anything else is returned as-is so the
  // pass-through is invariant for non-JSON callers.
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return response;
  }

  // Tee the body — Response is single-consumption so we read once and
  // rebuild a fresh Response for the caller.
  let bodyText: string;
  try {
    bodyText = await response.clone().text();
  } catch (err) {
    log.warn("Failed to clone response body for caching", {
      error: err instanceof Error ? err.message : String(err),
    });
    return response;
  }
  let bodyJson: unknown;
  try {
    bodyJson = bodyText.length > 0 ? JSON.parse(bodyText) : null;
  } catch {
    // Non-JSON body despite the Content-Type — skip caching.
    return response;
  }

  try {
    await db
      .insert(idempotencyKeys)
      .values({
        key: trimmed,
        route,
        userId,
        responseStatus: response.status,
        // Drizzle's jsonb column accepts any JSON-shaped value.
        responseBody: bodyJson as never,
      })
      .onConflictDoNothing({ target: idempotencyKeys.key });
  } catch (err) {
    // A duplicate-key error here means a concurrent request beat us to the
    // INSERT; the next replay will hit the cache. Log + return as normal.
    log.warn("Insert failed; cache miss recorded", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return response;
}

/**
 * Delete idempotency rows older than 24h. Best-effort; safe to call from a
 * cron loop. Returns the count of rows removed for logging / metrics.
 */
export async function pruneExpiredIdempotencyKeys(): Promise<number> {
  const cutoff = new Date(Date.now() - TTL_MS);
  try {
    const removed = await db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.createdAt, cutoff))
      .returning({ key: idempotencyKeys.key });
    return removed.length;
  } catch (err) {
    log.warn("Prune failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

// Suppress unused-import warnings when consumers don't use these helpers.
void and;
void sql;

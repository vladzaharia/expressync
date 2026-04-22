/**
 * Polaris Track A — user-facing error scrubber.
 *
 * Strips Lago/StEvE internals (URLs, request IDs, internal stack frames,
 * pgsql column names) from the error messages we render to customers.
 * Admins still see the full error in admin tooling — the scrubbed message
 * is for the customer surface only.
 *
 * Usage:
 *   } catch (err) {
 *     const safe = mapServiceError(err);
 *     return new Response(JSON.stringify({ error: safe }), { status: 502 });
 *   }
 *
 * Falls back to a generic "Something went wrong" if the error doesn't match
 * any known mapping — the customer never sees raw internal text.
 */

import { CUSTOMER_ERROR_COPY } from "./copy/customer-errors.ts";

/** Sanitize and map a service error to a customer-facing string. */
export function mapServiceError(err: unknown): string {
  // Generic catch-all. We err on the side of LESS information rather than
  // more — customers don't need the upstream URL.
  const fallback = CUSTOMER_ERROR_COPY.GENERIC;

  if (err == null) return fallback;

  // String-coerce defensively. `err` could be a string, Error, plain object, etc.
  const raw = err instanceof Error ? err.message : String(err);
  if (!raw) return fallback;

  // Lago-specific signatures.
  if (/lago/i.test(raw) || raw.includes("getlago")) {
    if (/customer.*not.*found|404/i.test(raw)) {
      return CUSTOMER_ERROR_COPY.LAGO_CUSTOMER_NOT_FOUND;
    }
    if (/timeout|ETIMEDOUT|ECONNRESET/i.test(raw)) {
      return CUSTOMER_ERROR_COPY.UPSTREAM_TIMEOUT;
    }
    if (/5\d\d/.test(raw)) {
      return CUSTOMER_ERROR_COPY.BILLING_UNAVAILABLE;
    }
    return CUSTOMER_ERROR_COPY.BILLING_UNAVAILABLE;
  }

  // StEvE / OCPP signatures.
  if (/steve|ocpp/i.test(raw)) {
    if (/timeout|ETIMEDOUT|ECONNRESET/i.test(raw)) {
      return CUSTOMER_ERROR_COPY.UPSTREAM_TIMEOUT;
    }
    if (/charger.*offline|not.*reachable/i.test(raw)) {
      return CUSTOMER_ERROR_COPY.CHARGER_OFFLINE;
    }
    return CUSTOMER_ERROR_COPY.CHARGER_UNAVAILABLE;
  }

  // Postgres signatures (column names + ERRCODE references in messages).
  if (/PG\d+|relation .* does not exist|column .* does not exist/i.test(raw)) {
    return fallback;
  }

  // Common HTTP-style messages — keep them but strip URL noise.
  if (/^(Not Found|Forbidden|Unauthorized|Bad Request)/i.test(raw)) {
    return raw.split(":")[0]; // drop everything after the first colon
  }

  return fallback;
}

/**
 * Diagnostic helper: returns BOTH the safe customer message AND the original
 * raw error for logging. The raw value is intended for server logs only.
 */
export function mapServiceErrorWithRaw(
  err: unknown,
): { safe: string; raw: string } {
  const raw = err instanceof Error
    ? `${err.name}: ${err.message}`
    : String(err);
  return { safe: mapServiceError(err), raw };
}

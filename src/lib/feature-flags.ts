/**
 * Polaris Track A — feature flags.
 *
 * Re-exports the env-derived flags from `config.ts` so call sites can import
 * a stable interface (`FEATURE_MAGIC_LINK`) without having to know whether
 * the source is env, a remote toggle service, or a per-request override.
 *
 * Endpoints that gate on a flag should respond `503 Service Unavailable`
 * with `Retry-After: 0` when the flag is off — that signals "we know about
 * this feature, it's just not on right now" rather than `404 Not Found`
 * which would suggest the route doesn't exist.
 */

import { config } from "./config.ts";

export const FEATURE_MAGIC_LINK: boolean = config.FEATURE_MAGIC_LINK;
export const FEATURE_SCAN_LOGIN: boolean = config.FEATURE_SCAN_LOGIN;

/**
 * Build a 503 Response for a feature gated off in this environment.
 * `feature` is the human-readable name (logged + included in the body).
 */
export function featureDisabledResponse(feature: string): Response {
  return new Response(
    JSON.stringify({
      error: `Feature '${feature}' is currently disabled`,
      retry: false,
    }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "0",
      },
    },
  );
}

/**
 * POST /api/devices/register — placeholder.
 *
 * ExpresScan / Wave 1 Track A wires up bearer auth + the device tables
 * but does NOT implement the registration flow (PKCE one-time code,
 * `withIdempotency`, latency-floor jitter, token + secret minting).
 * That belongs to Wave 2's **B-lifecycle** track — see
 * `expresscan/docs/plan/30-backend.md` § "Registration flow (PKCE)".
 *
 * Returning `501 Not Implemented` here keeps `deno task check` green and
 * locks the route into the auth-scheme map so a future bearer-flavored
 * misconfiguration can't slip in.
 */

import { define } from "../../../utils.ts";

function notImplemented(): Response {
  return new Response(
    JSON.stringify({
      error: "not_implemented",
      detail: "Track A placeholder — implemented in Wave 2 (B-lifecycle).",
    }),
    {
      status: 501,
      headers: { "Content-Type": "application/json" },
    },
  );
}

export const handler = define.handlers({
  POST() {
    return notImplemented();
  },
});

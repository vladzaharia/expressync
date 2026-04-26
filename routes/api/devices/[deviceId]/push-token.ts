/**
 * PUT /api/devices/{deviceId}/push-token — placeholder.
 *
 * Bearer-authenticated. Updates `devices.push_token` and `apns_environment`.
 * Implemented in Wave 2 (B-lifecycle).
 */

import { define } from "../../../../utils.ts";

export const handler = define.handlers({
  PUT() {
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
  },
});

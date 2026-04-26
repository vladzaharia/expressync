/**
 * POST /api/devices/heartbeat — placeholder.
 *
 * Bearer-authenticated. Will bump `devices.last_seen_at`. Implemented in
 * Wave 2 (B-lifecycle).
 */

import { define } from "../../../utils.ts";

export const handler = define.handlers({
  POST() {
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

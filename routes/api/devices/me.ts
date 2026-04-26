/**
 * GET /api/devices/me — placeholder.
 *
 * Bearer-authenticated. Returns the device's own identity for sanity
 * checks. Implemented in Wave 2 (B-lifecycle).
 */

import { define } from "../../../utils.ts";

export const handler = define.handlers({
  GET() {
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

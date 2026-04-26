/**
 * GET /api/devices/scan-stream — placeholder.
 *
 * Bearer-authenticated SSE stream. Will deliver `device.scan.requested`
 * events to the iOS app. Implemented in Wave 2 (C-stream).
 */

import { define } from "../../../utils.ts";

export const handler = define.handlers({
  GET() {
    return new Response(
      JSON.stringify({
        error: "not_implemented",
        detail: "Track A placeholder — implemented in Wave 2 (C-stream).",
      }),
      {
        status: 501,
        headers: { "Content-Type": "application/json" },
      },
    );
  },
});

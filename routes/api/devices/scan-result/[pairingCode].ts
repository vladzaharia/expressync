/**
 * GET /api/devices/scan-result/{pairingCode} — placeholder.
 *
 * Bearer-authenticated polling fallback for an enriched scan result the
 * device has already submitted. Implemented in Wave 3 (C-result).
 */

import { define } from "../../../../utils.ts";

export const handler = define.handlers({
  GET() {
    return new Response(
      JSON.stringify({
        error: "not_implemented",
        detail: "Track A placeholder — implemented in Wave 3 (C-result).",
      }),
      {
        status: 501,
        headers: { "Content-Type": "application/json" },
      },
    );
  },
});

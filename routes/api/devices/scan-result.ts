/**
 * POST /api/devices/scan-result — placeholder.
 *
 * Bearer-authenticated. Accepts {idTag, pairingCode, ts, nonce}; verifies
 * HMAC, atomically claims the pairing row, returns enriched scan-result.
 * Implemented in Wave 3 (C-result).
 */

import { define } from "../../../utils.ts";

export const handler = define.handlers({
  POST() {
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

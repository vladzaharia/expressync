/**
 * /admin/chargers — legacy redirect.
 *
 * The chargers and scanners listings have been merged into a single unified
 * `/admin/devices` page (April 2026). External links / bookmarks / emails
 * pointing at the old path land here and redirect into the new surface with
 * the type filter pre-applied so the visual context is preserved.
 *
 * 302 (not 307) because this is a navigation page only and we want the
 * browser address bar to update.
 */

import { define } from "../../../utils.ts";

export const handler = define.handlers({
  GET() {
    return new Response(null, {
      status: 302,
      headers: { Location: "/admin/devices?type=charger" },
    });
  },
});

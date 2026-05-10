/**
 * GET /maps/style/{variant}.json
 *
 * Serves a MapLibre style JSON with the MapTiler key injected
 * server-side, so the key never lands in the client bundle. The
 * `variant` path segment selects the file under `static/maps/` —
 * supports `light` and `dark` today.
 *
 * The MAPTILER_KEY env var is read at request time (not at module
 * import) so a key rotation takes effect on the next request without
 * a server restart. Falls back to a placeholder string in dev if
 * unset; MapLibre will simply fail tile requests, surfacing the
 * config error visibly rather than rendering a broken-looking map.
 *
 * Cache: `Cache-Control: max-age=300, must-revalidate` so the browser
 * doesn't refetch the JSON on every map mount, but the key rotates
 * within 5 minutes if we change it.
 */

import { define } from "../../../utils.ts";

const ALLOWED_VARIANTS = new Set(["light", "dark"]);

export const handler = define.handlers({
  async GET(ctx) {
    const variant = ctx.params.variant as string | undefined;
    if (!variant || !variant.endsWith(".json")) {
      return new Response("not_found", { status: 404 });
    }
    const stem = variant.slice(0, -".json".length);
    if (!ALLOWED_VARIANTS.has(stem)) {
      return new Response("not_found", { status: 404 });
    }

    let raw: string;
    try {
      raw = await Deno.readTextFile(`static/maps/style-${stem}.json`);
    } catch {
      return new Response("style_not_found", { status: 404 });
    }
    const key = Deno.env.get("MAPTILER_KEY") ?? "MAPTILER_KEY_NOT_SET";
    const interpolated = raw.replaceAll("__MAPTILER_KEY__", key);
    return new Response(interpolated, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300, must-revalidate",
      },
    });
  },
});

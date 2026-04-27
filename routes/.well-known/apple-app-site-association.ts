/**
 * GET /.well-known/apple-app-site-association
 *
 * ExpresScan / Wave 4 Track C-e2e — Apple Universal Links manifest.
 *
 * Apple's CDN validator
 * (`https://app-site-association.cdn-apple.com/a/v1/<host>`) fetches this
 * exact path WITHOUT auth. The response MUST be:
 *   - HTTP 200
 *   - `Content-Type: application/json`
 *   - No redirects
 *   - Valid JSON
 *
 * The committed bundle ID `48H7CLBV8Y.gg.vlad.expresscan` matches the iOS
 * app's signing identity and the path component `/expresscan/register/*`
 * matches the Universal Link landing page emitted by the registration
 * flow (see `30-backend.md` § "Registration flow (PKCE)").
 *
 * Only the admin host (`manage.polaris.express`) needs to serve this —
 * the customer host doesn't have the iOS app — but this handler is
 * surface-agnostic. The route classifier marks `/.well-known/*` as
 * PUBLIC; the admin path-rewrite skips `/.well-known/` so the file is
 * reached at the URL root regardless of host.
 *
 * The matching JSON file `apple-app-site-association.json` lives next
 * to this handler so a developer eyeballing the directory can confirm
 * the manifest contents at a glance, and so an external static-file
 * pre-hosting setup (CDN edge cache, Apple's own validator) can fetch
 * it byte-for-byte equivalent if the path is reconfigured to serve
 * `.json` extensions in the future. The handler reads the file at
 * import time so we get a single source of truth.
 */

import { define } from "../../utils.ts";
import manifest from "./apple-app-site-association.json" with { type: "json" };

// Inline-imported via Vite's JSON loader so the manifest ships inside the
// route bundle (Vite does NOT copy arbitrary sibling `.json` files into
// `_fresh/server/assets/`, so a `Deno.readTextFile()` at runtime fails in
// the production container).
const MANIFEST_TEXT = JSON.stringify(manifest);

export const handler = define.handlers({
  GET(_ctx): Response {
    return new Response(MANIFEST_TEXT, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // Apple's validator caches by content; a short TTL means a future
        // bundle-ID change propagates quickly. 1 hour is conservative.
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
});

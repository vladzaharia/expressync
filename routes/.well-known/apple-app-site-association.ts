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
 * The committed bundle ID `ABC1234XYZ.com.example.expresscharge.ios` matches the iOS
 * app's signing identity. The four component paths cover:
 *   - `/app/register/*` — admin-host PKCE registration landing
 *   - `/c/*`            — customer-host charger sticker deep link
 *   - `/u/*`            — customer-host user-QR sign-in
 *   - `/m/*`            — customer-host magic-email sign-in landing
 *
 * Both hosts (`manage.example.com` and `example.com`) serve this
 * file: the route classifier marks `/.well-known/*` as PUBLIC and the
 * admin path-rewrite skips `/.well-known/`, so the manifest is reached
 * at the URL root regardless of host. iOS entitlements list both
 * `applinks:manage.example.com` and `applinks:example.com`.
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

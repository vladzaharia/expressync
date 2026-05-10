# Maps — MapLibre GL deployment

ExpresScan's admin UI uses MapLibre GL for every map surface (charger location
editor, device-details location card, future fleet view). Tiles + glyphs +
sprites come from MapTiler today; the path to a fully self-hosted PMTiles
deployment is documented below.

## Today: MapTiler-hosted tiles

The free MapTiler tier serves ~100k tile requests / month — easily enough for a
friends-and-family deployment.

### Setup

1. Sign up at <https://www.maptiler.com/cloud/> — free tier doesn't require a
   credit card.
2. Generate an API key under Account → Keys.
3. Set the key on greenwood-ts:
   ```
   ssh vlad@greenwood-ts
   cd /docker/services/expressync
   echo 'MAPTILER_KEY=<your-key>' >> .env
   docker compose up -d app
   ```

The key is read by `routes/maps/style/[variant].ts` at request time (not module
load) so a key rotation takes effect on the next style fetch — no restart
needed.

### Why we proxy the style JSON server-side

The MapTiler key would otherwise need to live in the client bundle, which is a
leak surface. The route at `/maps/style/{variant}.json` reads the static style
JSON from `static/maps/style-{variant}.json`, substitutes `__MAPTILER_KEY__`
server-side, and returns the interpolated JSON. The browser fetches
`/maps/style/light.json` and never sees the key directly.

The 5-minute `Cache-Control` header strikes a reasonable balance: a key rotation
propagates within minutes, but every map mount doesn't re-fetch the JSON.

## Style variants

- `static/maps/style-light.json` — neutral slate background, brand accent colour
  for water/parks. Used by default.
- `static/maps/style-dark.json` — admin dark mode (future). Pass
  `styleUrl="/maps/style/dark.json"` to `<PinMap>`.

Both styles use the OpenMapTiles vector schema (`tiles/v3`), which matches the
PMTiles option below.

## Future: self-hosted PMTiles

If MapTiler usage outgrows the free tier or we want zero external deps:

1. Download a Protomaps planet PMTiles file (or a regional extract) from
   <https://maps.protomaps.com/builds/>.
2. Serve it from `static/tiles/world.pmtiles` (or a separate volume).
3. Update both style JSONs to use a `pmtiles://` source URL:
   ```
   "openmaptiles": {
     "type": "vector",
     "url": "pmtiles:///tiles/world.pmtiles"
   }
   ```
4. Register the PMTiles protocol in `PinMap.tsx` before the map constructor:
   ```ts
   const { Protocol } = await import("pmtiles");
   const protocol = new Protocol();
   maplibregl.addProtocol("pmtiles", protocol.tile);
   ```
5. Vendor sprites + glyphs locally (the MapTiler URLs in the style JSON would
   also need to swap to local paths).

A planet PMTiles is ~120 GB; a US-only extract is ~5 GB. For the
friends-and-family deployment a regional extract is the right trade-off.

## What lives where

- `islands/maps/PinMap.tsx` — single shared component for both display + edit
  modes. Replaces the prior Leaflet pin-drop.
- `routes/maps/style/[variant].ts` — server-side style endpoint.
- `static/maps/style-*.json` — style files (key-placeholder pre-interpolation).
- `routes/api/admin/geocode.ts` + `src/lib/utils/nominatim.ts` — unchanged.
  Geocoding still goes through Nominatim; only the map rendering moved.

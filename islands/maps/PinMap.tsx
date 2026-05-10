/**
 * PinMap — shared MapLibre GL pin component used across the admin UI.
 *
 * Two modes:
 *   - mode="display": read-only pin at fixed coords. Used by the
 *     device-details Location card to show last-known location.
 *     Optional `accuracyMeters` renders a circle around the pin.
 *   - mode="edit": draggable pin; click anywhere to drop. Fires
 *     `onChange(lat, lon)`. Drop-in replacement for the previous
 *     `LeafletPinDrop` consumed by `ChargerLocationEditor`; props
 *     `(latitude, longitude, onChange, height)` are preserved.
 *
 * Tiles: MapTiler-hosted via `MAPTILER_KEY` env var. The key is
 * server-injected through `routes/maps/style/[variant].ts` so it
 * never lands in the client bundle. Document a self-hosted PMTiles
 * alternative in `docs/maps.md`.
 *
 * MapLibre is window-dependent; we dynamic-import inside `useEffect`
 * so the SSR pass doesn't try to evaluate it. The CSS gets injected
 * the same way Leaflet's was — single idempotent `<link>` on first
 * mount.
 */

import { useEffect, useRef } from "preact/hooks";

const MAPLIBRE_CSS_HREF =
  "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";

function ensureMapLibreCss() {
  if (typeof document === "undefined") return;
  if (document.querySelector("link[data-maplibre]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = MAPLIBRE_CSS_HREF;
  link.crossOrigin = "anonymous";
  link.dataset.maplibre = "true";
  document.head.appendChild(link);
}

interface PinMapPropsBase {
  /** Container pixel height. Defaults to 320. */
  height?: number;
  /** Initial zoom level. Defaults to 15 for edit mode, 14 for display. */
  zoom?: number;
  /** Style URL — defaults to `/maps/style/light.json` (server-injected
   *  MapTiler key). Pass `/maps/style/dark.json` for dark variant. */
  styleUrl?: string;
  /** Hide every UI control (zoom/compass/attribution) for tiny
   *  embedded previews. */
  interactive?: boolean;
}

interface DisplayProps extends PinMapPropsBase {
  mode: "display";
  latitude: number;
  longitude: number;
  /** Optional fix accuracy — rendered as a circle around the pin. */
  accuracyMeters?: number;
}

interface EditProps extends PinMapPropsBase {
  mode: "edit";
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number, lon: number) => void;
}

export type PinMapProps = DisplayProps | EditProps;

export default function PinMap(props: PinMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // deno-lint-ignore no-explicit-any
  const mapRef = useRef<any>(null);
  // deno-lint-ignore no-explicit-any
  const markerRef = useRef<any>(null);

  // Build / mount the map once.
  useEffect(() => {
    if (!containerRef.current) return;
    ensureMapLibreCss();
    let disposed = false;

    (async () => {
      const maplibregl = (await import("maplibre-gl")).default;
      if (disposed || !containerRef.current) return;

      const initialLat = props.latitude ?? 0;
      const initialLon = props.longitude ?? 0;
      const hasInitialPin = props.latitude != null && props.longitude != null;
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: props.styleUrl ?? "/maps/style/light.json",
        center: [initialLon, initialLat],
        zoom: props.zoom ?? (props.mode === "edit" ? 15 : 14),
        interactive: props.interactive ?? true,
        attributionControl: { compact: true },
      });
      mapRef.current = map;

      if (hasInitialPin) {
        const marker = new maplibregl.Marker({
          draggable: props.mode === "edit",
          color: "#0d9488", // teal-600 — matches the admin accent
        })
          .setLngLat([initialLon, initialLat])
          .addTo(map);
        markerRef.current = marker;

        if (props.mode === "edit") {
          marker.on("dragend", () => {
            const { lng, lat } = marker.getLngLat();
            (props as EditProps).onChange(lat, lng);
          });
        }
      }

      if (props.mode === "edit") {
        // Click-to-drop. Reuses the same marker if one exists.
        map.on("click", (e: { lngLat: { lng: number; lat: number } }) => {
          const { lng, lat } = e.lngLat;
          if (markerRef.current) {
            markerRef.current.setLngLat([lng, lat]);
          } else {
            const marker = new maplibregl.Marker({
              draggable: true,
              color: "#0d9488",
            })
              .setLngLat([lng, lat])
              .addTo(map);
            markerRef.current = marker;
            marker.on("dragend", () => {
              const ll = marker.getLngLat();
              (props as EditProps).onChange(ll.lat, ll.lng);
            });
          }
          (props as EditProps).onChange(lat, lng);
        });
      }

      // Display-mode accuracy circle.
      if (
        props.mode === "display" && props.accuracyMeters &&
        props.accuracyMeters > 0
      ) {
        map.on("load", () => {
          const radius = props.accuracyMeters!;
          map.addSource("accuracy", {
            type: "geojson",
            data: makeCirclePolygon(initialLon, initialLat, radius),
          });
          map.addLayer({
            id: "accuracy-fill",
            type: "fill",
            source: "accuracy",
            paint: {
              "fill-color": "#0d9488",
              "fill-opacity": 0.15,
            },
          });
          map.addLayer({
            id: "accuracy-stroke",
            type: "line",
            source: "accuracy",
            paint: {
              "line-color": "#0d9488",
              "line-width": 1,
            },
          });
        });
      }
    })();

    return () => {
      disposed = true;
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // We only mount the map ONCE; prop changes are handled by the
    // second effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect prop coordinate changes onto the existing map (e.g. when
  // the parent form's lat/lon inputs change after geocoding).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const lat = props.latitude;
    const lon = props.longitude;
    if (lat == null || lon == null) {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      return;
    }
    if (markerRef.current) {
      markerRef.current.setLngLat([lon, lat]);
    } else {
      // Late-arriving pin (display mode): create the marker now.
      (async () => {
        const maplibregl = (await import("maplibre-gl")).default;
        const marker = new maplibregl.Marker({
          draggable: props.mode === "edit",
          color: "#0d9488",
        })
          .setLngLat([lon, lat])
          .addTo(map);
        markerRef.current = marker;
        if (props.mode === "edit") {
          marker.on("dragend", () => {
            const ll = marker.getLngLat();
            (props as EditProps).onChange(ll.lat, ll.lng);
          });
        }
      })();
    }
    map.flyTo({ center: [lon, lat], zoom: map.getZoom() });
  }, [props.latitude, props.longitude]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: `${props.height ?? 320}px` }}
      class="rounded-md overflow-hidden border border-slate-200"
    />
  );
}

/**
 * Build a circle polygon (geographic) approximating `radiusMeters`
 * around `(lon, lat)`. 64-segment regular polygon — good enough for a
 * fix-accuracy ring, cheap.
 *
 * Returns a structurally-typed GeoJSON Feature. We don't pull in the
 * `@types/geojson` namespace here because the structural type
 * matches what MapLibre's `addSource({type:"geojson"})` accepts
 * verbatim.
 */
interface CirclePolygonFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
  properties: Record<string, unknown>;
}

function makeCirclePolygon(
  lon: number,
  lat: number,
  radiusMeters: number,
): CirclePolygonFeature {
  const segments = 64;
  const earthRadius = 6_378_137; // m
  const angularDistance = radiusMeters / earthRadius;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const ring: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const bearing = (i * 2 * Math.PI) / segments;
    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);
    const sinD = Math.sin(angularDistance);
    const cosD = Math.cos(angularDistance);
    const sinLat2 = sinLat * cosD + cosLat * sinD * Math.cos(bearing);
    const lat2 = Math.asin(sinLat2);
    const lon2 = lonRad +
      Math.atan2(
        Math.sin(bearing) * sinD * cosLat,
        cosD - sinLat * sinLat2,
      );
    ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: {},
  };
}

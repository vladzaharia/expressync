/**
 * LeafletPinDrop — interactive OpenStreetMap pin-drop for the
 * ChargerLocationEditor.
 *
 * Used inside the editor's edit-mode form so the admin can drag a
 * marker to the charger's exact spot and have lat/lon write back to
 * the parent form's coordinate fields. Tapping anywhere on the map
 * also re-positions the marker — both interactions converge on the
 * same `onChange(lat, lon)` callback.
 *
 * Implementation notes:
 *   - Leaflet is window-dependent; we dynamic-import it inside an
 *     effect so the SSR pass doesn't try to evaluate `L`.
 *   - The default Leaflet marker icon resolves relative paths
 *     (`marker-icon.png`, `marker-shadow.png`) that Vite can't
 *     bundle reliably. We override `Icon.Default.prototype.options`
 *     with absolute unpkg URLs so markers render in production.
 *   - CSS is pulled from unpkg via a stylesheet `<link>` injected on
 *     mount and idempotent (data-leaflet flag). Avoids globbing the
 *     leaflet.css through Vite's asset pipeline.
 */

import { useEffect, useRef } from "preact/hooks";

const LEAFLET_CSS_HREF = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_CSS_INTEGRITY =
  "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
const ICON_BASE = "https://unpkg.com/leaflet@1.9.4/dist/images/";

interface LeafletPinDropProps {
  /** Initial latitude — accepts undefined / null for "no pin yet"
   *  (map then centres on the world default and shows no marker
   *  until the user clicks to drop one). */
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number, lon: number) => void;
  /** Pixel height of the map container. Defaults to 320. */
  height?: number;
}

function ensureLeafletCss() {
  if (typeof document === "undefined") return;
  if (document.querySelector("link[data-leaflet]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = LEAFLET_CSS_HREF;
  link.integrity = LEAFLET_CSS_INTEGRITY;
  link.crossOrigin = "anonymous";
  link.dataset.leaflet = "true";
  document.head.appendChild(link);
}

export default function LeafletPinDrop(
  { latitude, longitude, onChange, height = 320 }: LeafletPinDropProps,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Hold the live Leaflet objects across renders without re-creating them.
  // deno-lint-ignore no-explicit-any
  const mapRef = useRef<any>(null);
  // deno-lint-ignore no-explicit-any
  const markerRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    let teardownMap: (() => void) | null = null;

    (async () => {
      if (!containerRef.current) return;
      ensureLeafletCss();
      // Dynamic import — `leaflet` references `window` at the top
      // level, so a static import would crash the SSR bundle even
      // though this island only renders client-side.
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      // Override the marker icon URLs so production builds don't
      // request relative `marker-icon.png` paths the bundler can't
      // resolve.
      // deno-lint-ignore no-explicit-any
      const Icon = (L as any).Icon;
      delete Icon.Default.prototype._getIconUrl;
      Icon.Default.mergeOptions({
        iconUrl: `${ICON_BASE}marker-icon.png`,
        iconRetinaUrl: `${ICON_BASE}marker-icon-2x.png`,
        shadowUrl: `${ICON_BASE}marker-shadow.png`,
      });

      // World-centred default when we don't have a pin yet.
      const initialCentre: [number, number] = (latitude != null &&
          longitude != null)
        ? [latitude, longitude]
        : [37.7749, -122.4194];
      const initialZoom = (latitude != null && longitude != null) ? 17 : 3;

      const map = L.map(containerRef.current, {
        center: initialCentre,
        zoom: initialZoom,
        scrollWheelZoom: true,
        attributionControl: true,
      });
      mapRef.current = map;

      L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        },
      ).addTo(map);

      const placeMarker = (lat: number, lon: number) => {
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lon]);
        } else {
          const marker = L.marker([lat, lon], { draggable: true });
          marker.addTo(map);
          marker.on("dragend", () => {
            const p = marker.getLatLng();
            onChange(p.lat, p.lng);
          });
          markerRef.current = marker;
        }
      };

      if (latitude != null && longitude != null) {
        placeMarker(latitude, longitude);
      }

      map.on("click", (e: { latlng: { lat: number; lng: number } }) => {
        placeMarker(e.latlng.lat, e.latlng.lng);
        onChange(e.latlng.lat, e.latlng.lng);
      });

      // Resize-handle: when the editor toggles edit mode the
      // container is hidden then shown, and Leaflet caches sizes
      // wrong unless we tell it to recalculate.
      requestAnimationFrame(() => map.invalidateSize());

      teardownMap = () => {
        map.off();
        map.remove();
        mapRef.current = null;
        markerRef.current = null;
      };
    })();

    return () => {
      cancelled = true;
      teardownMap?.();
    };
    // Initial mount only — `latitude/longitude/onChange` updates are
    // handled in the second effect below to avoid tearing the map
    // down on every keystroke.
  }, []);

  // Re-position the marker when the parent's lat/lon changes (e.g.
  // user pasted in coordinates or hit "Use my location"). Doesn't
  // re-create the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (latitude == null || longitude == null) return;
    (async () => {
      const L = await import("leaflet");
      const marker = markerRef.current;
      if (marker) {
        marker.setLatLng([latitude, longitude]);
      } else {
        // deno-lint-ignore no-explicit-any
        const m = (L as any).marker([latitude, longitude], { draggable: true });
        m.addTo(map);
        m.on("dragend", () => {
          const p = m.getLatLng();
          onChange(p.lat, p.lng);
        });
        markerRef.current = m;
      }
      map.flyTo([latitude, longitude], Math.max(map.getZoom(), 14), {
        duration: 0.4,
      });
    })();
  }, [latitude, longitude]);

  return (
    <div
      ref={containerRef}
      style={{ height: `${height}px`, width: "100%" }}
      class="overflow-hidden rounded-md border bg-muted/20"
      role="application"
      aria-label="Drag the marker or click to set the charger's location"
    />
  );
}

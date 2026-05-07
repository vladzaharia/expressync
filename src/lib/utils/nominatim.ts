/**
 * Server-side Nominatim (OpenStreetMap) client used by the
 * `/api/admin/geocode` proxy. Wraps two endpoints:
 *
 *   - search:  free-text → `[{ lat, lon, address... }]`
 *   - reverse: lat/lon  → `{ address... }`
 *
 * Nominatim's usage policy requires a meaningful User-Agent with
 * contact info and a global rate limit ≤ 1 rps. We honor both via
 * the constants below; the limit is process-local (single-region
 * deployment) which is fine for the admin tooling that's the only
 * consumer of this client.
 */

const USER_AGENT = "ExpresSync/1.0 (accounts@vlad.gg)";
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";

// 1 request per second floor — Nominatim's published policy.
const MIN_INTERVAL_MS = 1100;
let lastCallAt = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = lastCallAt + MIN_INTERVAL_MS - now;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastCallAt = Date.now();
}

export interface NominatimAddress {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
  displayName: string;
}

interface RawAddress {
  house_number?: string;
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  state?: string;
  region?: string;
  postcode?: string;
  country_code?: string;
}

interface RawResult {
  lat: string;
  lon: string;
  display_name: string;
  address?: RawAddress;
}

function normalize(raw: RawResult): NominatimAddress {
  const a = raw.address ?? {};
  const line1Parts: string[] = [];
  if (a.house_number) line1Parts.push(a.house_number);
  if (a.road) line1Parts.push(a.road);

  return {
    addressLine1: line1Parts.length ? line1Parts.join(" ") : null,
    addressLine2: a.neighbourhood ?? a.suburb ?? null,
    city: a.city ?? a.town ?? a.village ?? null,
    region: a.state ?? a.region ?? null,
    postalCode: a.postcode ?? null,
    country: a.country_code ? a.country_code.toUpperCase() : null,
    latitude: Number(raw.lat),
    longitude: Number(raw.lon),
    displayName: raw.display_name,
  };
}

export async function geocodeForward(
  query: string,
): Promise<NominatimAddress | null> {
  await throttle();
  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`nominatim search ${res.status}`);
  }
  const rows = (await res.json()) as RawResult[];
  if (!rows.length) return null;
  return normalize(rows[0]);
}

export async function geocodeReverse(
  latitude: number,
  longitude: number,
): Promise<NominatimAddress | null> {
  await throttle();
  const url = new URL(`${NOMINATIM_BASE}/reverse`);
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`nominatim reverse ${res.status}`);
  }
  const raw = (await res.json()) as RawResult & { error?: string };
  if (!raw || raw.error) return null;
  return normalize(raw);
}

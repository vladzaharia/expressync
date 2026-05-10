/**
 * DeviceLocationCard — admin-only Phase 2b consumer surface.
 *
 * Renders last-known location for a managed device:
 *   - coordinates (mono, copyable)
 *   - accuracy `±N m`
 *   - relative timestamp ("3 minutes ago") + absolute on hover
 *   - "Open in Maps" link → Apple Maps
 *   - embedded MapLibre PinMap pin
 *   - "Locate now" button → POST /api/admin/devices/{id}/locate;
 *     polls device-state for a newer last_location_at and resolves
 *     within ~30s (timeout otherwise).
 *
 * Renders only when the device carries the `managed` capability —
 * the parent passes `enabled` based on `device.capabilities`. Off
 * devices show a muted hint pointing to the capabilities section.
 */

import { useCallback, useEffect, useState } from "preact/hooks";
import { ExternalLink, Loader2, MapPin, RefreshCcw } from "lucide-preact";
import PinMap from "../maps/PinMap.tsx";

interface Props {
  deviceId: string;
  enabled: boolean;
  /** Server-rendered initial values; if managed but never reported,
   *  these are all null and the card shows an "awaiting first fix"
   *  hint. */
  initialLat: number | null;
  initialLon: number | null;
  initialAccuracyM: number | null;
  initialAtIso: string | null;
}

interface DeviceStatePeek {
  lastLocationLat: number | null;
  lastLocationLon: number | null;
  lastLocationAccuracyM: number | null;
  lastLocationAt: string | null;
}

export default function DeviceLocationCard(props: Props) {
  const [lat, setLat] = useState<number | null>(props.initialLat);
  const [lon, setLon] = useState<number | null>(props.initialLon);
  const [accuracy, setAccuracy] = useState<number | null>(
    props.initialAccuracyM,
  );
  const [atIso, setAtIso] = useState<string | null>(props.initialAtIso);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, forceTick] = useState(0);

  // Re-render every 30 s so the relative-timestamp string drifts.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const peek = useCallback(async (): Promise<DeviceStatePeek | null> => {
    try {
      const res = await fetch(
        `/api/admin/devices/${props.deviceId}`,
        { credentials: "include", headers: { Accept: "application/json" } },
      );
      if (!res.ok) return null;
      const body = await res.json() as Record<string, unknown>;
      // Be liberal in what we accept — the device admin endpoint
      // shape may evolve. We just want the four location fields.
      const get = (k: string) => body[k] ?? null;
      const num = (v: unknown): number | null =>
        typeof v === "number" ? v : null;
      const str = (v: unknown): string | null =>
        typeof v === "string" ? v : null;
      return {
        lastLocationLat: num(get("lastLocationLat")),
        lastLocationLon: num(get("lastLocationLon")),
        lastLocationAccuracyM: num(get("lastLocationAccuracyM")),
        lastLocationAt: str(get("lastLocationAt")),
      };
    } catch {
      return null;
    }
  }, [props.deviceId]);

  const onLocateNow = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/devices/${props.deviceId}/locate`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as {
          error?: string;
          reason?: string;
        };
        const reason = body.reason ?? body.error ?? `HTTP ${res.status}`;
        setError(`Push failed: ${reason}`);
        setPending(false);
        return;
      }
      // Poll device row until last_location_at advances or 30 s pass.
      const startedAt = Date.now();
      const previousAtMs = atIso ? Date.parse(atIso) : 0;
      let resolved = false;
      while (Date.now() - startedAt < 30_000) {
        await new Promise((r) => setTimeout(r, 2_000));
        const next = await peek();
        if (next?.lastLocationAt) {
          const ms = Date.parse(next.lastLocationAt);
          if (ms > previousAtMs) {
            setLat(next.lastLocationLat);
            setLon(next.lastLocationLon);
            setAccuracy(next.lastLocationAccuracyM);
            setAtIso(next.lastLocationAt);
            resolved = true;
            break;
          }
        }
      }
      if (!resolved) {
        setError(
          "Device didn't respond within 30s. Check that it's online and has the managed capability.",
        );
      }
    } finally {
      setPending(false);
    }
  };

  if (!props.enabled) {
    return (
      <p class="text-sm text-muted-foreground">
        Managed capability not enabled. Grant the{" "}
        <span class="font-mono text-xs">managed</span>{" "}
        capability above to enable last-known location and "Locate now".
      </p>
    );
  }

  if (lat == null || lon == null) {
    return (
      <div class="space-y-3">
        <p class="text-sm text-muted-foreground">
          Awaiting first location report. The device will publish its location
          on the next significant-change event or when "Locate now" is pressed.
        </p>
        <button
          type="button"
          onClick={onLocateNow}
          disabled={pending}
          class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
        >
          {pending
            ? <Loader2 class="size-4 animate-spin" aria-hidden />
            : <RefreshCcw class="size-4" aria-hidden />}
          {pending ? "Waiting…" : "Locate now"}
        </button>
        {error && <p class="text-sm text-rose-700">{error}</p>}
      </div>
    );
  }

  const appleMapsUrl =
    `https://maps.apple.com/?ll=${lat},${lon}&q=${lat},${lon}`;
  const coordsText = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

  return (
    <div class="space-y-3">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div class="space-y-2">
          <div class="text-xs uppercase tracking-wide text-slate-500">
            Coordinates
          </div>
          <div class="font-mono text-sm">{coordsText}</div>
          {accuracy != null && (
            <div class="text-xs text-slate-500">
              ±{Math.round(accuracy)} m accuracy
            </div>
          )}
          <div class="text-xs text-slate-500">
            <RelativeTime iso={atIso} />
          </div>
          <div class="flex flex-wrap gap-2 pt-1">
            <a
              href={appleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
            >
              <ExternalLink class="size-3.5" aria-hidden /> Apple Maps
            </a>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(coordsText)}
              class="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
            >
              <MapPin class="size-3.5" aria-hidden /> Copy
            </button>
            <button
              type="button"
              onClick={onLocateNow}
              disabled={pending}
              class="ml-auto inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
            >
              {pending
                ? <Loader2 class="size-3.5 animate-spin" aria-hidden />
                : <RefreshCcw class="size-3.5" aria-hidden />}
              {pending ? "Waiting…" : "Locate now"}
            </button>
          </div>
          {error && <p class="text-sm text-rose-700">{error}</p>}
        </div>
        <PinMap
          mode="display"
          latitude={lat}
          longitude={lon}
          accuracyMeters={accuracy ?? undefined}
          height={220}
        />
      </div>
    </div>
  );
}

function RelativeTime({ iso }: { iso: string | null }) {
  if (!iso) return <span>Unknown</span>;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return <span>Unknown</span>;
  const deltaMs = Date.now() - ms;
  const text = formatRelative(deltaMs);
  const absolute = new Date(ms).toLocaleString();
  return <span title={absolute}>{text}</span>;
}

function formatRelative(deltaMs: number): string {
  const seconds = Math.round(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

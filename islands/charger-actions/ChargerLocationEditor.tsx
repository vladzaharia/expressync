/**
 * ChargerLocationEditor — inline editor for the charger's structured
 * address + lat/lon. Admin clicks "Edit", fills out the form, hits
 * "Save" — single PATCH to `/api/admin/charger/[chargeBoxId]`, then
 * reloads so the detail page re-renders from fresh server state.
 *
 * Mirrors the existing `ChargerFormFactorSelect` /
 * `ChargerConnectorOverrideSelect` pattern: single island, single
 * PATCH, reload on success. Country select is driven by
 * `i18n-iso-countries`; region select uses `country-state-city` and
 * gracefully falls back to a free-text input when the country has no
 * subdivisions in the dataset.
 *
 * "Use my location" pulls `navigator.geolocation` and reverse-
 * geocodes via `/api/admin/geocode`. "Look up from address"
 * forward-geocodes via the same proxy. The Leaflet pin-drop widget
 * the original plan called for is intentionally deferred — for the
 * friends-and-family deployment, browser geolocation + Nominatim
 * proxy cover the address-pin-drop UX without the bundle weight.
 */

import { useEffect, useMemo, useState } from "preact/hooks";
import { Loader2, MapPin } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { toast } from "sonner";
import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json" with { type: "json" };
// `country-state-city` ships its dataset as JS modules; we load the
// state list lazily from the named export so we don't pay the
// 200KB+ data cost on the initial page render.
import { State } from "country-state-city";

countries.registerLocale(
  en as unknown as Parameters<typeof countries.registerLocale>[0],
);

interface ChargerLocationEditorProps {
  chargeBoxId: string;
  initial: {
    addressLine1: string | null;
    addressLine2: string | null;
    addressCity: string | null;
    addressRegion: string | null;
    addressPostalCode: string | null;
    addressCountry: string | null;
    latitude: number | null;
    longitude: number | null;
  };
}

interface FormState {
  addressLine1: string;
  addressLine2: string;
  addressCity: string;
  addressRegion: string;
  addressPostalCode: string;
  addressCountry: string;
  latitude: string;
  longitude: string;
}

function emptyForm(initial: ChargerLocationEditorProps["initial"]): FormState {
  return {
    addressLine1: initial.addressLine1 ?? "",
    addressLine2: initial.addressLine2 ?? "",
    addressCity: initial.addressCity ?? "",
    addressRegion: initial.addressRegion ?? "",
    addressPostalCode: initial.addressPostalCode ?? "",
    addressCountry: initial.addressCountry ?? "",
    latitude: initial.latitude != null ? String(initial.latitude) : "",
    longitude: initial.longitude != null ? String(initial.longitude) : "",
  };
}

export default function ChargerLocationEditor(
  { chargeBoxId, initial }: ChargerLocationEditorProps,
) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm(initial));
  const [geocodePending, setGeocodePending] = useState(false);

  // Reset the form when caller's `initial` changes (e.g. after a
  // server-side reload that doesn't unmount the island).
  useEffect(() => {
    setForm(emptyForm(initial));
  }, [
    initial.addressLine1,
    initial.addressLine2,
    initial.addressCity,
    initial.addressRegion,
    initial.addressPostalCode,
    initial.addressCountry,
    initial.latitude,
    initial.longitude,
  ]);

  const countryOptions = useMemo(() => {
    const map = countries.getNames("en") as Record<string, string>;
    return Object.entries(map)
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const regionOptions = useMemo(() => {
    if (!form.addressCountry) {
      return [] as Array<{ code: string; name: string }>;
    }
    try {
      const states = State.getStatesOfCountry(form.addressCountry) ?? [];
      return states.map((s) => ({ code: s.isoCode, name: s.name }));
    } catch {
      return [];
    }
  }, [form.addressCountry]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const onUseMyLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("Geolocation isn't available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        update("latitude", pos.coords.latitude.toFixed(6));
        update("longitude", pos.coords.longitude.toFixed(6));
        toast.success("Captured browser location.");
      },
      (err) => {
        toast.error(`Couldn't get location: ${err.message}`);
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  };

  const onLookupFromAddress = async () => {
    const q = [
      form.addressLine1,
      form.addressCity,
      form.addressRegion,
      form.addressPostalCode,
      form.addressCountry,
    ]
      .filter((s) => s.trim() !== "")
      .join(", ");
    if (!q) {
      toast.error("Fill in address fields first.");
      return;
    }
    setGeocodePending(true);
    try {
      const res = await fetch("/api/admin/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      if (!res.ok) {
        if (res.status === 404) {
          toast.error("Couldn't find that address.");
        } else {
          toast.error(`Geocode failed: ${res.status}`);
        }
        return;
      }
      const data = await res.json();
      update("latitude", String(data.latitude));
      update("longitude", String(data.longitude));
      toast.success("Got coordinates from address.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Geocode failed");
    } finally {
      setGeocodePending(false);
    }
  };

  const onLookupFromCoords = async () => {
    const lat = Number(form.latitude);
    const lon = Number(form.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      toast.error("Enter valid latitude and longitude first.");
      return;
    }
    setGeocodePending(true);
    try {
      const res = await fetch("/api/admin/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lon }),
      });
      if (!res.ok) {
        toast.error("Reverse geocode failed.");
        return;
      }
      const data = await res.json();
      update("addressLine1", data.addressLine1 ?? "");
      update("addressCity", data.city ?? "");
      update("addressRegion", data.region ?? "");
      update("addressPostalCode", data.postalCode ?? "");
      update("addressCountry", data.country ?? "");
      toast.success("Filled address from coordinates.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Geocode failed");
    } finally {
      setGeocodePending(false);
    }
  };

  const onSave = async () => {
    if (pending) return;
    setPending(true);
    try {
      const lat = form.latitude.trim() === "" ? null : Number(form.latitude);
      const lon = form.longitude.trim() === "" ? null : Number(form.longitude);
      const body: Record<string, unknown> = {
        addressLine1: form.addressLine1.trim() || null,
        addressLine2: form.addressLine2.trim() || null,
        addressCity: form.addressCity.trim() || null,
        addressRegion: form.addressRegion.trim() || null,
        addressPostalCode: form.addressPostalCode.trim() || null,
        addressCountry: form.addressCountry.trim().toUpperCase() || null,
        latitude: lat,
        longitude: lon,
      };
      const res = await fetch(
        `/api/admin/charger/${encodeURIComponent(chargeBoxId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      toast.success("Location saved.");
      // Reload so server-rendered fields refresh.
      globalThis.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
      setPending(false);
    }
  };

  const onCancel = () => {
    setForm(emptyForm(initial));
    setEditing(false);
  };

  if (!editing) {
    return (
      <div class="flex items-start gap-3">
        <div class="flex-1">
          <ReadOnlyView initial={initial} />
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <MapPin class="mr-2 h-4 w-4" />
          Edit
        </Button>
      </div>
    );
  }

  return (
    <div class="space-y-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="space-y-1 sm:col-span-2">
          <Label>Street address</Label>
          <Input
            placeholder="123 Main Street"
            value={form.addressLine1}
            onInput={(e) =>
              update(
                "addressLine1",
                (e.currentTarget as HTMLInputElement).value,
              )}
            disabled={pending}
          />
        </div>
        <div class="space-y-1 sm:col-span-2">
          <Label>Address line 2</Label>
          <Input
            placeholder="Apt / Unit / Bay"
            value={form.addressLine2}
            onInput={(e) =>
              update(
                "addressLine2",
                (e.currentTarget as HTMLInputElement).value,
              )}
            disabled={pending}
          />
        </div>
        <div class="space-y-1">
          <Label>City</Label>
          <Input
            value={form.addressCity}
            onInput={(e) =>
              update(
                "addressCity",
                (e.currentTarget as HTMLInputElement).value,
              )}
            disabled={pending}
          />
        </div>
        <div class="space-y-1">
          <Label>Postal code</Label>
          <Input
            value={form.addressPostalCode}
            onInput={(e) =>
              update(
                "addressPostalCode",
                (e.currentTarget as HTMLInputElement).value,
              )}
            disabled={pending}
          />
        </div>
        <div class="space-y-1">
          <Label>Country</Label>
          <Select
            value={form.addressCountry}
            onValueChange={(v: string) => {
              update("addressCountry", v);
              // Region depends on country — clear when country changes.
              update("addressRegion", "");
            }}
            disabled={pending}
          >
            <SelectTrigger class="h-9">
              <SelectValue placeholder="Pick a country" />
            </SelectTrigger>
            <SelectContent>
              {countryOptions.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div class="space-y-1">
          <Label>Region / state</Label>
          {regionOptions.length > 0
            ? (
              <Select
                value={form.addressRegion}
                onValueChange={(v: string) => update("addressRegion", v)}
                disabled={pending}
              >
                <SelectTrigger class="h-9">
                  <SelectValue placeholder="Pick a region" />
                </SelectTrigger>
                <SelectContent>
                  {regionOptions.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
            : (
              <Input
                placeholder={form.addressCountry
                  ? "Region / state code"
                  : "(pick a country first)"}
                value={form.addressRegion}
                onInput={(e) =>
                  update(
                    "addressRegion",
                    (e.currentTarget as HTMLInputElement).value,
                  )}
                disabled={pending || !form.addressCountry}
              />
            )}
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        <div class="space-y-1">
          <Label>Latitude</Label>
          <Input
            placeholder="-90 to 90"
            inputMode="decimal"
            value={form.latitude}
            onInput={(e) =>
              update("latitude", (e.currentTarget as HTMLInputElement).value)}
            disabled={pending}
          />
        </div>
        <div class="space-y-1">
          <Label>Longitude</Label>
          <Input
            placeholder="-180 to 180"
            inputMode="decimal"
            value={form.longitude}
            onInput={(e) =>
              update("longitude", (e.currentTarget as HTMLInputElement).value)}
            disabled={pending}
          />
        </div>
        <div class="flex items-end">
          <Button
            variant="outline"
            size="sm"
            onClick={onUseMyLocation}
            disabled={pending}
            class="w-full"
          >
            Use my location
          </Button>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onLookupFromAddress}
          disabled={pending || geocodePending}
        >
          {geocodePending && <Loader2 class="mr-2 h-3.5 w-3.5 animate-spin" />}
          Look up coords from address
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onLookupFromCoords}
          disabled={pending || geocodePending}
        >
          {geocodePending && <Loader2 class="mr-2 h-3.5 w-3.5 animate-spin" />}
          Look up address from coords
        </Button>
      </div>

      <div class="flex justify-end gap-2 border-t pt-3">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={onSave} disabled={pending}>
          {pending && <Loader2 class="mr-2 h-4 w-4 animate-spin" />}
          Save location
        </Button>
      </div>
    </div>
  );
}

function ReadOnlyView(
  { initial }: { initial: ChargerLocationEditorProps["initial"] },
) {
  const hasAddress = initial.addressLine1 || initial.addressCity ||
    initial.addressCountry;
  const hasCoords = initial.latitude != null || initial.longitude != null;
  if (!hasAddress && !hasCoords) {
    return (
      <p class="text-sm text-muted-foreground">
        No address or coordinates set.
      </p>
    );
  }
  return (
    <dl class="grid grid-cols-3 gap-y-1 text-sm">
      {hasAddress && (
        <>
          <dt class="text-muted-foreground">Address</dt>
          <dd class="col-span-2">
            {[
              initial.addressLine1,
              initial.addressLine2,
              [
                initial.addressCity,
                initial.addressRegion,
                initial.addressPostalCode,
              ].filter((s) => s).join(" "),
              initial.addressCountry,
            ]
              .filter((s) => s && s.trim() !== "")
              .join(", ")}
          </dd>
        </>
      )}
      {hasCoords && (
        <>
          <dt class="text-muted-foreground">Coordinates</dt>
          <dd class="col-span-2 font-mono text-xs">
            {initial.latitude ?? "—"}, {initial.longitude ?? "—"}
          </dd>
        </>
      )}
    </dl>
  );
}

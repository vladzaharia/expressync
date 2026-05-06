/**
 * NewUnmanagedChargerForm — POSTs to `/api/admin/chargers/unmanaged`.
 *
 * Renders inside the create page's `SectionCard`. Surfaces inline
 * validation errors and a 409 conflict ("already exists") in the same
 * `text-destructive` style as other admin forms; on 201 redirects to
 * the new charger's detail page.
 */

import { useState } from "preact/hooks";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { FORM_FACTORS, type FormFactor } from "@/src/lib/types/steve.ts";

const FORM_FACTOR_LABEL: Record<FormFactor, string> = {
  wallbox: "Wallbox",
  pulsar: "Pulsar",
  commander: "Commander",
  wall_mount: "Wall mount",
  generic: "Generic",
};

const CHARGE_BOX_ID_RE = /^[A-Za-z0-9_\-.:]{1,64}$/;

export default function NewUnmanagedChargerForm() {
  const [chargeBoxId, setChargeBoxId] = useState("");
  const [friendlyName, setFriendlyName] = useState("");
  const [locationDescription, setLocationDescription] = useState("");
  const [formFactor, setFormFactor] = useState<FormFactor>("wall_mount");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: Event) => {
    e.preventDefault();
    setError(null);

    const idTrimmed = chargeBoxId.trim();
    const nameTrimmed = friendlyName.trim();
    const locTrimmed = locationDescription.trim();

    if (!CHARGE_BOX_ID_RE.test(idTrimmed)) {
      setError(
        "Charger ID must be 1-64 chars, letters/digits/_-.:",
      );
      return;
    }
    if (nameTrimmed.length === 0 || nameTrimmed.length > 200) {
      setError("Friendly name is required (1-200 chars).");
      return;
    }
    if (locTrimmed.length > 500) {
      setError("Location description is too long (max 500 chars).");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/chargers/unmanaged", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chargeBoxId: idTrimmed,
          friendlyName: nameTrimmed,
          locationDescription: locTrimmed.length > 0 ? locTrimmed : null,
          formFactor,
        }),
      });

      if (res.status === 201) {
        globalThis.location.href = `/admin/chargers/${
          encodeURIComponent(idTrimmed)
        }`;
        return;
      }

      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setError(
          body.message ??
            `A charger with ID "${idTrimmed}" already exists.`,
        );
      } else if (res.status === 403) {
        setError("You don't have permission to create chargers.");
      } else {
        setError(body.error ?? "Failed to create charger. Please try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form class="flex flex-col gap-4" onSubmit={submit} noValidate>
      <label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium">Friendly name</span>
        <Input
          name="friendlyName"
          placeholder="Garage Tesla WC"
          value={friendlyName}
          onInput={(e) =>
            setFriendlyName((e.currentTarget as HTMLInputElement).value)}
          maxLength={200}
          required
          disabled={submitting}
        />
      </label>

      <label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium">Charger ID</span>
        <Input
          name="chargeBoxId"
          placeholder="tesla-wc-001 (use the unit's serial or any unique tag)"
          value={chargeBoxId}
          onInput={(e) =>
            setChargeBoxId((e.currentTarget as HTMLInputElement).value)}
          maxLength={64}
          required
          disabled={submitting}
        />
        <span class="text-xs text-muted-foreground">
          Use the charger's serial number or any unique identifier. Cannot be
          changed after creation. Letters, digits, and <code>_ - . :</code>{" "}
          only.
        </span>
      </label>

      <label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium">Location description</span>
        <textarea
          name="locationDescription"
          placeholder="North parking lot, level 2"
          value={locationDescription}
          onInput={(e) =>
            setLocationDescription(
              (e.currentTarget as HTMLTextAreaElement).value,
            )}
          maxLength={500}
          rows={2}
          disabled={submitting}
          class="rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />
        <span class="text-xs text-muted-foreground">
          Optional. Shown to customers on the public scan landing page.
        </span>
      </label>

      <label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium">Form factor</span>
        <select
          name="formFactor"
          value={formFactor}
          onChange={(e) =>
            setFormFactor(
              (e.currentTarget as HTMLSelectElement).value as FormFactor,
            )}
          disabled={submitting}
          class="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {FORM_FACTORS.map((ff) => (
            <option key={ff} value={ff}>{FORM_FACTOR_LABEL[ff]}</option>
          ))}
        </select>
      </label>

      {error && (
        <p class="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div class="mt-2 flex items-center gap-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create charger"}
        </Button>
        <Button type="button" variant="outline" asChild>
          <a href="/admin/devices">Cancel</a>
        </Button>
      </div>
    </form>
  );
}

/**
 * Charger Identity card (island).
 *
 * Slim hero card after the 2026-05 redesign:
 *   - Form factor (smart-select; drives the brand icon)
 *   - Friendly name (smart-text; falls back to chargeBoxId)
 *   - Vendor / Model / Firmware — admin-editable overrides that take
 *     precedence over StEvE-reported values; clearing the override
 *     reverts to the StEvE value (if any).
 *   - First seen / Last seen
 *
 * Removed in the redesign: chargeBoxPk, OCPP protocol, ICCID, the
 * per-charger connector type / max-kW (now lives on each connector card
 * as part of the per-connector spec).
 */

import { useState } from "preact/hooks";
import { Check, Copy, X } from "lucide-preact";
import SmartTextField from "./shared/SmartTextField.tsx";
import SmartSelectField from "./shared/SmartSelectField.tsx";
import { FORM_FACTOR_LABELS, FORM_FACTORS } from "@/src/lib/types/steve.ts";
import {
  chargerFormFactorIcons,
  GenericChargerIcon,
} from "@/components/brand/chargers/index.ts";
import { cn } from "@/src/lib/utils/cn.ts";
import { STATUS_HALO, type UiStatus } from "./shared/device-visuals.ts";

interface Props {
  chargeBoxId: string;
  /** Current friendly name (admin-editable). */
  friendlyName: string | null;
  /** Current form-factor enum value (admin-editable). */
  formFactor: string;
  firstSeenAtIso: string;
  lastSeenAtIso: string;
  /** Override-aware display values. The page route resolves
   *  `override ?? steveValue ?? null` before passing them in, so the
   *  card just renders. The `*Override` props carry the raw override
   *  for the smart-text input's source-of-truth. */
  vendor: string | null;
  vendorOverride: string | null;
  model: string | null;
  modelOverride: string | null;
  firmwareVersion: string | null;
  firmwareVersionOverride: string | null;
  uiStatus: UiStatus;
  isAdmin: boolean;
  class?: string;
}

function formatAbs(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function patchCharger(
  chargeBoxId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`/api/admin/charger/${chargeBoxId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `Save failed (HTTP ${res.status})`);
  }
}

const FORM_FACTOR_OPTIONS = FORM_FACTORS.map((value) => ({
  value,
  label: FORM_FACTOR_LABELS[value] ?? value,
}));

export default function ChargerIdentityCard({
  chargeBoxId,
  friendlyName,
  formFactor,
  firstSeenAtIso,
  lastSeenAtIso,
  vendor,
  vendorOverride,
  model,
  modelOverride,
  firmwareVersion,
  firmwareVersionOverride,
  uiStatus,
  isAdmin,
  class: className,
}: Props) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(chargeBoxId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Clipboard write failed", err);
    }
  };

  const IconComponent = chargerFormFactorIcons[
    formFactor as keyof typeof chargerFormFactorIcons
  ] ?? GenericChargerIcon;

  // For override fields the smart-text edits the override directly; the
  // displayed value (when the override is null) is the StEvE value, but
  // editing always replaces the override. This matches the user's
  // mental model: "I'm overriding StEvE."
  const onSaveOverride =
    (key: "vendorOverride" | "modelOverride" | "firmwareVersionOverride") =>
    async (next: string | null) => {
      await patchCharger(chargeBoxId, { [key]: next });
      // Reload so the page picks up the new effective value (override
      // ?? steveValue) and renders the cleared state correctly.
      globalThis.location.reload();
    };

  return (
    <div
      class={cn(
        "flex h-full flex-col gap-4 rounded-xl border bg-card p-5",
        className,
      )}
    >
      <div class="flex items-start gap-4">
        <div class="shrink-0" aria-hidden="true">
          <IconComponent size="lg" haloColor={STATUS_HALO[uiStatus]} />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-base font-semibold">
            {isAdmin
              ? (
                <SmartTextField
                  value={friendlyName}
                  placeholder={chargeBoxId}
                  ariaLabel="Edit friendly name"
                  onSave={async (next) => {
                    await patchCharger(chargeBoxId, { friendlyName: next });
                    globalThis.location.reload();
                  }}
                  class="text-base font-semibold"
                />
              )
              : <span class="truncate">{friendlyName ?? chargeBoxId}</span>}
          </div>
          <div class="mt-1 flex items-center gap-1.5">
            <code class="break-all rounded border bg-muted/40 px-2 py-0.5 font-mono text-xs">
              {chargeBoxId}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              aria-label={copied
                ? "Copied"
                : `Copy ${chargeBoxId} to clipboard`}
              title={copied ? "Copied" : "Copy chargeBoxId"}
              class="inline-flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {copied
                ? <Check class="size-3.5 text-emerald-500" />
                : <Copy class="size-3.5" />}
            </button>
          </div>
        </div>
      </div>

      <dl class="grid grid-cols-1 gap-y-2 text-sm">
        <div class="flex items-center justify-between gap-2">
          <dt class="text-muted-foreground">Form factor</dt>
          <dd>
            {isAdmin
              ? (
                <SmartSelectField
                  value={formFactor}
                  options={FORM_FACTOR_OPTIONS}
                  nullLabel={false}
                  ariaLabel="Edit form factor"
                  onSave={async (next) => {
                    if (!next) return;
                    await patchCharger(chargeBoxId, { formFactor: next });
                    globalThis.location.reload();
                  }}
                  class="font-medium"
                />
              )
              : (
                <span class="font-medium">
                  {FORM_FACTOR_LABELS[
                    formFactor as keyof typeof FORM_FACTOR_LABELS
                  ] ?? formFactor}
                </span>
              )}
          </dd>
        </div>

        <IdentityRow
          label="Vendor"
          value={vendor}
          override={vendorOverride}
          isAdmin={isAdmin}
          onSave={onSaveOverride("vendorOverride")}
        />
        <IdentityRow
          label="Model"
          value={model}
          override={modelOverride}
          isAdmin={isAdmin}
          onSave={onSaveOverride("modelOverride")}
        />
        <IdentityRow
          label="Firmware"
          value={firmwareVersion}
          override={firmwareVersionOverride}
          isAdmin={isAdmin}
          mono
          onSave={onSaveOverride("firmwareVersionOverride")}
        />

        <div class="mt-1 flex items-center justify-between gap-2 border-t pt-1">
          <dt class="text-muted-foreground">First seen</dt>
          <dd class="text-xs">{formatAbs(firstSeenAtIso)}</dd>
        </div>
        <div class="flex items-center justify-between gap-2">
          <dt class="text-muted-foreground">Last seen</dt>
          <dd class="text-xs">{formatAbs(lastSeenAtIso)}</dd>
        </div>
      </dl>
    </div>
  );
}

function IdentityRow({
  label,
  value,
  override,
  isAdmin,
  mono,
  onSave,
}: {
  label: string;
  /** Effective display value: override ?? steveValue ?? null. */
  value: string | null;
  /** The raw override; when non-null the field shows a small "(override)" hint. */
  override: string | null;
  isAdmin: boolean;
  mono?: boolean;
  onSave: (next: string | null) => Promise<void>;
}) {
  return (
    <div class="flex items-center justify-between gap-2">
      <dt class="text-muted-foreground">{label}</dt>
      <dd
        class={cn(
          "flex items-center gap-1",
          mono ? "font-mono text-xs" : "font-medium",
        )}
      >
        {isAdmin
          ? (
            <SmartTextField
              value={override ?? value}
              placeholder="—"
              ariaLabel={`Edit ${label.toLowerCase()} override`}
              onSave={onSave}
              class={mono ? "font-mono text-xs" : ""}
            />
          )
          : <span>{value ?? "—"}</span>}
        {override !== null && isAdmin && (
          <OverrideDot
            label={label}
            onClear={() => onSave(null)}
          />
        )}
        {override !== null && !isAdmin && (
          <span
            aria-hidden
            title="Admin override of the StEvE-reported value"
            class="size-2.5 shrink-0 rounded-full bg-amber-500"
          />
        )}
      </dd>
    </div>
  );
}

/**
 * Override-affordance dot.
 *
 * Hover/focus reveals a bare X (no background fill) — the same slot
 * just swaps from the small yellow dot to a yellow ✕ glyph. Click the
 * X (or the dot itself on touch) to clear the override.
 *
 * Touch fallback: with no hover, the first click "arms" the dot
 * (also swapping it to an X) and the second click invokes `onClear`.
 * Blur / Esc disarms.
 */
function OverrideDot({
  label,
  onClear,
}: {
  label: string;
  onClear: () => Promise<void> | void;
}) {
  const [armed, setArmed] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleClick = async (e: Event) => {
    e.stopPropagation();
    // Touch / keyboard: first click arms; second click clears.
    // Pointer hover paths skip the arm step because the hover state
    // already showed the X — see comment on the class chain below.
    if (!armed) {
      setArmed(true);
      return;
    }
    setClearing(true);
    try {
      await onClear();
    } finally {
      setClearing(false);
      setArmed(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onBlur={() => setArmed(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setArmed(false);
      }}
      disabled={clearing}
      title={armed
        ? `Click to clear ${label.toLowerCase()} override`
        : `${label} override applied`}
      aria-label={armed
        ? `Clear ${label.toLowerCase()} override`
        : `${label} override applied`}
      class={cn(
        "ml-1 inline-flex size-3 shrink-0 items-center justify-center text-amber-500 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:rounded-sm",
        // Idle: small filled yellow dot. Hover/focus/armed: bare X
        // glyph (no background fill), still yellow.
        armed ? "[&_.dot]:hidden" : "hover:[&_.dot]:hidden focus:[&_.dot]:hidden",
        armed ? "[&_.x]:block" : "[&_.x]:hidden hover:[&_.x]:block focus:[&_.x]:block",
        clearing && "opacity-50",
      )}
    >
      <span
        aria-hidden
        class="dot block size-2 rounded-full bg-amber-500"
      />
      <X aria-hidden class="x size-3" strokeWidth={3} />
    </button>
  );
}

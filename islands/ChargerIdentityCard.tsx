/**
 * Charger Identity card (island).
 *
 * Lightweight — almost all fields are read-only. The `ChargerFormFactorSelect`
 * nested island handles the one admin-editable field. We keep this component
 * as an island so the "copy chargeBoxId" button can use the browser clipboard
 * API without needing a second island just for the copy.
 */

import { useState } from "preact/hooks";
import { Check, Copy } from "lucide-preact";
import ChargerFormFactorSelect from "./ChargerFormFactorSelect.tsx";
import { FORM_FACTORS } from "@/src/lib/types/steve.ts";
import {
  chargerFormFactorIcons,
  GenericChargerIcon,
} from "@/components/brand/chargers/index.ts";
import { cn } from "@/src/lib/utils/cn.ts";
import { STATUS_HALO, type UiStatus } from "./shared/charger-visuals.ts";

interface Props {
  chargeBoxId: string;
  chargeBoxPk: number | null;
  friendlyName: string | null;
  formFactor: string;
  firstSeenAtIso: string;
  lastSeenAtIso: string;
  ocppProtocol: string | null;
  vendor: string | null;
  model: string | null;
  firmwareVersion: string | null;
  iccid: string | null;
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

export default function ChargerIdentityCard({
  chargeBoxId,
  chargeBoxPk,
  friendlyName,
  formFactor,
  firstSeenAtIso,
  lastSeenAtIso,
  ocppProtocol,
  vendor,
  model,
  firmwareVersion,
  iccid,
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
          <div class="text-base font-semibold truncate">
            {friendlyName ?? chargeBoxId}
          </div>
          <div class="mt-1 flex items-center gap-1.5">
            <code class="truncate rounded border bg-muted/40 px-2 py-0.5 font-mono text-xs">
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
                <ChargerFormFactorSelect
                  chargeBoxId={chargeBoxId}
                  value={formFactor}
                  options={[...FORM_FACTORS]}
                />
              )
              : <span class="font-medium">{formFactor}</span>}
          </dd>
        </div>

        <div class="flex items-center justify-between gap-2">
          <dt class="text-muted-foreground">StEvE PK</dt>
          <dd class="font-mono text-xs">{chargeBoxPk ?? "—"}</dd>
        </div>

        <div class="flex items-center justify-between gap-2">
          <dt class="text-muted-foreground">OCPP protocol</dt>
          <dd class="font-mono text-xs">{ocppProtocol ?? "—"}</dd>
        </div>

        <div class="flex items-center justify-between gap-2">
          <dt class="text-muted-foreground">Vendor</dt>
          <dd class="font-medium">{vendor ?? "—"}</dd>
        </div>

        <div class="flex items-center justify-between gap-2">
          <dt class="text-muted-foreground">Model</dt>
          <dd>{model ?? "—"}</dd>
        </div>

        <div class="flex items-center justify-between gap-2">
          <dt class="text-muted-foreground">Firmware</dt>
          <dd class="font-mono text-xs">{firmwareVersion ?? "—"}</dd>
        </div>

        <div class="flex items-center justify-between gap-2">
          <dt class="text-muted-foreground">ICCID</dt>
          <dd class="font-mono text-xs">{iccid ?? "—"}</dd>
        </div>

        <div class="flex items-center justify-between gap-2 pt-1 border-t mt-1">
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

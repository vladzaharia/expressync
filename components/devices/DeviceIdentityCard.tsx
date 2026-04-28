/**
 * DeviceIdentityCard — left-column identity hero on the device detail
 * page. Layout deliberately mirrors `ChargerIdentityCard`:
 *
 *   ┌──────────────────────────────────────┐
 *   │ [icon]   Device label                │   ← bold display name
 *   │          [deviceId · copy]           │   ← copyable id chip
 *   ├──────────────────────────────────────┤
 *   │ Label        [editable input]        │
 *   │ Kind          Phone                  │
 *   │ Model         iPhone 15 Pro          │
 *   │ OS            iOS 26                 │
 *   │ App version   1.4.2 (203)            │
 *   │ Owner         alice@…                │
 *   │ Capabilities  [pills]                │
 *   ├──────────────────────────────────────┤
 *   │ Registered    …                      │
 *   │ Last seen     …                      │
 *   └──────────────────────────────────────┘
 *
 * The editable Label row is the analogue of the charger card's
 * `ChargerFormFactorSelect` — it surfaces a one-shot rename island
 * (`DeviceLabelInput`) that POSTs `/api/admin/devices/{id}/rename` and
 * reloads. Everything else is read-only; the rest of the device's
 * configuration moves to the single-Save App Configuration form below
 * this card.
 */

import { Check, Copy, Smartphone } from "lucide-preact";
import { useState } from "preact/hooks";
import DeviceLabelInput from "@/islands/devices/DeviceLabelInput.tsx";
import { CapabilityPill } from "@/components/devices/CapabilityPill.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

export interface DeviceIdentityCardProps {
  deviceId: string;
  kind: "phone_nfc" | "tablet_nfc" | "laptop_nfc";
  label: string;
  platform: string | null;
  model: string | null;
  osVersion: string | null;
  appVersion: string | null;
  ownerUserId: string | null;
  ownerEmail?: string | null;
  capabilities: string[];
  isOnline: boolean;
  lastSeenAtIso: string | null;
  registeredAtIso: string;
  isAdmin?: boolean;
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

function kindLabel(
  kind: DeviceIdentityCardProps["kind"],
): string {
  switch (kind) {
    case "phone_nfc":
      return "Phone";
    case "tablet_nfc":
      return "Tablet";
    case "laptop_nfc":
      return "Laptop";
  }
}

const TEAL_HALO = "#14b8a6";

export function DeviceIdentityCard({
  deviceId,
  kind,
  label,
  platform,
  model,
  osVersion,
  appVersion,
  ownerUserId,
  ownerEmail,
  capabilities,
  isOnline,
  lastSeenAtIso,
  registeredAtIso,
  isAdmin = true,
  class: className,
}: DeviceIdentityCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(deviceId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Clipboard write failed", err);
    }
  };

  const ownerDisplay = ownerEmail ?? ownerUserId ?? "—";
  const modelDisplay = model && platform
    ? model
    : (model ?? platform ?? "—");

  return (
    <div
      class={cn(
        "flex h-full flex-col gap-4 rounded-xl border bg-card p-5",
        className,
      )}
    >
      <div class="flex items-start gap-4">
        <div class="shrink-0" aria-hidden="true">
          <div
            class="flex size-12 items-center justify-center rounded-full"
            style={{
              background: `${isOnline ? TEAL_HALO : "#94a3b8"}1A`,
              color: isOnline ? TEAL_HALO : "#64748b",
            }}
          >
            <Smartphone class="size-6" />
          </div>
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-base font-semibold truncate">{label}</div>
          <div class="mt-1 flex items-center gap-1.5">
            <code class="truncate rounded border bg-muted/40 px-2 py-0.5 font-mono text-xs">
              {deviceId}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              aria-label={copied ? "Copied" : `Copy ${deviceId} to clipboard`}
              title={copied ? "Copied" : "Copy device ID"}
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
          <dt class="text-muted-foreground">Label</dt>
          <dd>
            {isAdmin
              ? <DeviceLabelInput deviceId={deviceId} value={label} />
              : <span class="font-medium">{label}</span>}
          </dd>
        </div>

        <div class="flex items-center justify-between gap-2">
          <dt class="text-muted-foreground">Kind</dt>
          <dd class="font-medium">{kindLabel(kind)}</dd>
        </div>

        <div class="flex items-center justify-between gap-2">
          <dt class="text-muted-foreground">Model</dt>
          <dd class="text-right">{modelDisplay}</dd>
        </div>

        <div class="flex items-center justify-between gap-2">
          <dt class="text-muted-foreground">OS</dt>
          <dd class="font-mono text-xs">{osVersion ?? "—"}</dd>
        </div>

        <div class="flex items-center justify-between gap-2">
          <dt class="text-muted-foreground">App version</dt>
          <dd class="font-mono text-xs">{appVersion ?? "—"}</dd>
        </div>

        <div class="flex items-center justify-between gap-2">
          <dt class="text-muted-foreground">Owner</dt>
          <dd class="truncate text-right">
            {ownerUserId
              ? (
                <a
                  href={`/admin/users/${ownerUserId}`}
                  class="hover:underline"
                  title={ownerUserId}
                >
                  {ownerDisplay}
                </a>
              )
              : "—"}
          </dd>
        </div>

        <div class="flex items-start justify-between gap-2">
          <dt class="text-muted-foreground pt-0.5">Capabilities</dt>
          <dd class="flex flex-wrap items-center justify-end gap-1">
            {capabilities.length === 0
              ? <span class="text-xs text-muted-foreground">—</span>
              : capabilities.map((c) => (
                <CapabilityPill key={c} capability={c} />
              ))}
          </dd>
        </div>

        <div class="flex items-center justify-between gap-2 pt-1 border-t mt-1">
          <dt class="text-muted-foreground">Registered</dt>
          <dd class="text-xs">{formatAbs(registeredAtIso)}</dd>
        </div>

        <div class="flex items-center justify-between gap-2">
          <dt class="text-muted-foreground">Last seen</dt>
          <dd class="text-xs">
            {isOnline ? "Online now" : formatAbs(lastSeenAtIso)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

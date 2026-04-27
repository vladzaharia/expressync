/**
 * DeviceIdentityCard — `SectionCard`-shaped identity strip for the device
 * detail page.
 *
 * Lays out the device's read-only identity facts as a grid of `MetricTile`s:
 *   - Model (with platform OS suffix)
 *   - OS version
 *   - App version
 *   - Owner (linked to /admin/users/{ownerId})
 *   - Last seen (relative)
 *   - Push token presence (Active / Missing pill)
 *   - Registered date (absolute)
 *
 * Rendered as a `SectionCard` with `accent="teal"` so it inherits the page's
 * accent. No editable fields here — rename happens via the `DeviceActionsMenu`
 * row action and the page's `headerActions` slot, not inline on the identity
 * card. Mirrors the spirit of `ChargerIdentityCard` but without the form-
 * factor select (devices are kind-typed at register time).
 */

import {
  AppWindow,
  Calendar,
  Check,
  Clock,
  ExternalLink,
  KeyRound,
  Layers,
  Smartphone,
  User as UserIcon,
} from "lucide-preact";
import { SectionCard } from "@/components/shared/SectionCard.tsx";
import { MetricTile } from "@/components/shared/MetricTile.tsx";
import { CapabilityPill } from "@/components/devices/CapabilityPill.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { formatRelative } from "@/islands/shared/device-visuals.ts";

export interface DeviceIdentityCardProps {
  deviceId: string;
  kind: "phone_nfc" | "laptop_nfc";
  label: string;
  platform: string | null;
  model: string | null;
  osVersion: string | null;
  appVersion: string | null;
  ownerUserId: string | null;
  ownerEmail?: string | null;
  capabilities: string[];
  pushTokenLast8: string | null;
  /** "production" | "sandbox" — surfaced as small chip next to the push token presence pill. */
  apnsEnvironment: string | null;
  /** When true the "Last seen" tile renders "Online now" — the relative
   *  time would be redundant with the live pill in the header strip. */
  isOnline: boolean;
  lastSeenAtIso: string | null;
  registeredAtIso: string;
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

/**
 * Pill for "Active" / "Missing" push-token state.
 *
 *   - Active  → emerald (positive — device is reachable via push)
 *   - Missing → amber (advisory — push not registered yet, fall back to SSE)
 */
function PushTokenPill(
  { last8, env }: { last8: string | null; env: string | null },
) {
  if (last8 === null) {
    return (
      <span class="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
        <KeyRound class="size-3" aria-hidden="true" />
        Missing
      </span>
    );
  }
  return (
    <span class="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
      <Check class="size-3" aria-hidden="true" />
      Active
      <span class="font-mono opacity-80">··{last8.slice(-4)}</span>
      {env && env !== "production" && (
        <span class="rounded border border-amber-500/40 bg-amber-500/10 px-1 text-[10px] uppercase">
          {env}
        </span>
      )}
    </span>
  );
}

export function DeviceIdentityCard({
  deviceId: _deviceId,
  kind,
  label,
  platform,
  model,
  osVersion,
  appVersion,
  ownerUserId,
  ownerEmail,
  capabilities,
  pushTokenLast8,
  apnsEnvironment,
  isOnline,
  lastSeenAtIso,
  registeredAtIso,
  class: className,
}: DeviceIdentityCardProps) {
  // Derive a short "model" string that includes platform when both are
  // present ("iPhone 15 Pro · iOS"). Tolerates either being null.
  const modelDisplay = (() => {
    if (!model && !platform) return "—";
    if (model && platform) return `${model} · ${platform}`;
    return (model ?? platform) as string;
  })();

  const ownerDisplay = ownerEmail ?? ownerUserId ?? "—";

  // Description: form-factor + model when present. The technical
  // `deviceId` lives only as the page URL — surfacing it inline here
  // doubled up with the device label in the title.
  const description = modelDisplay && modelDisplay !== "—"
    ? `${kind === "phone_nfc" ? "Phone" : "Laptop"} · ${modelDisplay}`
    : kind === "phone_nfc"
    ? "Phone"
    : "Laptop";

  return (
    <SectionCard
      title={label}
      description={description}
      icon={Smartphone}
      accent="teal"
      className={cn(className)}
    >
      <div class="flex flex-col gap-5">
        <div class="flex flex-wrap items-center gap-1.5">
          {capabilities.length === 0
            ? (
              <span class="text-xs text-muted-foreground">
                No capabilities granted
              </span>
            )
            : capabilities.map((cap) => (
              <CapabilityPill key={cap} capability={cap} />
            ))}
          <span class="ml-auto">
            <PushTokenPill last8={pushTokenLast8} env={apnsEnvironment} />
          </span>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricTile
            icon={Layers}
            label="Model"
            value={modelDisplay}
            accent="teal"
          />
          <MetricTile
            icon={Smartphone}
            label="OS"
            value={osVersion ?? "—"}
            accent="teal"
          />
          <MetricTile
            icon={AppWindow}
            label="App version"
            value={appVersion ?? "—"}
            accent="teal"
          />
          <MetricTile
            icon={UserIcon}
            label="Owner"
            value={ownerUserId
              ? (
                <a
                  href={`/admin/users/${ownerUserId}`}
                  class="inline-flex items-center gap-1 hover:underline"
                  title={ownerUserId}
                >
                  <span class="truncate max-w-[16ch]">{ownerDisplay}</span>
                  <ExternalLink
                    class="size-3 shrink-0 opacity-60"
                    aria-hidden="true"
                  />
                </a>
              )
              : "—"}
            accent="teal"
          />
          <MetricTile
            icon={Clock}
            label={isOnline ? "Status" : "Last seen"}
            value={isOnline ? "Online now" : formatRelative(lastSeenAtIso)}
            sublabel={isOnline
              ? undefined
              : lastSeenAtIso
              ? formatAbs(lastSeenAtIso)
              : undefined}
            accent="teal"
          />
          <MetricTile
            icon={Calendar}
            label="Registered"
            value={formatAbs(registeredAtIso)}
            accent="teal"
          />
        </div>
      </div>
    </SectionCard>
  );
}

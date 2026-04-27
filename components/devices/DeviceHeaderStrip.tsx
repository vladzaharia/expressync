/**
 * Server-rendered header strip for `/admin/devices/[deviceId]`.
 *
 * Mirrors `components/chargers/ChargerHeaderStrip.tsx` so the scanner detail
 * page reads as a peer of the charger detail page: mono identifier + status
 * pill row (Online/Offline · capability roll-up · revoked / deregistered
 * dashed marker · last-seen relative).
 *
 * Server component — no interactive state. The live heartbeat freshness
 * surface lives inside the per-section cards.
 */

import { type Pill, StatusPillRow } from "@/components/tags/StatusPillRow.tsx";
import { formatRelative } from "@/islands/shared/device-visuals.ts";

interface Props {
  deviceId: string;
  /** Admin-set human label; falls back to `deviceId` for display. */
  label: string;
  kind: "phone_nfc" | "laptop_nfc";
  isOnline: boolean;
  lastSeenAtIso: string | null;
  capabilities: string[];
  ownerEmail: string | null;
  isDeregistered: boolean;
  isRevoked: boolean;
}

function summarizeCapabilities(caps: string[]): string {
  if (caps.length === 0) return "No capabilities";
  return caps.length === 1 ? `1 capability` : `${caps.length} capabilities`;
}

export function DeviceHeaderStrip(
  {
    deviceId,
    label,
    kind,
    isOnline,
    lastSeenAtIso,
    capabilities,
    ownerEmail,
    isDeregistered,
    isRevoked,
  }: Props,
) {
  const pills: Pill[] = [];

  if (isDeregistered) {
    pills.push({ label: "Deregistered", tone: "rose", dashed: true });
  } else if (isRevoked) {
    pills.push({ label: "Revoked", tone: "rose", dashed: true });
  } else {
    pills.push({
      label: isOnline ? "Online" : "Offline",
      tone: isOnline ? "emerald" : "muted",
      live: true,
    });
  }

  pills.push({
    label: kind === "phone_nfc" ? "Phone" : "Laptop",
    tone: "cyan",
  });

  pills.push({
    label: summarizeCapabilities(capabilities),
    tone: capabilities.length > 0 ? "neutral" : "muted",
  });

  // "Last seen X ago" only makes sense when the device isn't currently
  // reachable. When online, the Online pill above already conveys
  // liveness — appending a relative timestamp would just be misleading
  // ("Online · Last seen a few seconds ago" reads like two facts when
  // it's the same one).
  if (!isOnline) {
    if (lastSeenAtIso) {
      pills.push({
        label: `Last seen ${formatRelative(lastSeenAtIso)}`,
        tone: "muted",
      });
    } else {
      pills.push({ label: "Never seen", tone: "muted", dashed: true });
    }
  }

  if (ownerEmail) {
    pills.push({ label: ownerEmail, tone: "violet", title: "Owner" });
  }

  // Display name + technical id chip pattern, mirroring
  // `ChargerHeaderStrip`. Show the mono `deviceId` chip only when the
  // label is set — otherwise the chip would just duplicate the heading.
  const displayName = label?.trim() || deviceId;
  const showIdChip = !!label?.trim();

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-baseline gap-2">
        <span class="text-sm font-semibold tracking-tight">{displayName}</span>
        {showIdChip && (
          <code class="rounded bg-muted/60 px-2 py-0.5 font-mono text-xs text-muted-foreground">
            {deviceId}
          </code>
        )}
      </div>
      <StatusPillRow pills={pills} />
    </div>
  );
}

/**
 * Phase P5 — ProfileStatusBadge
 *
 * Renders the current sync state of a charging profile. Emerald when the
 * Lago mirror is up to date, amber when the mirror is behind with an error,
 * muted when the profile has not been saved yet.
 *
 * Implementation now routes through the canonical `<StatusBadge>` primitive.
 */

import { AlertTriangle, CheckCircle2 } from "lucide-preact";
import { StatusBadge } from "@/components/shared/StatusBadge.tsx";

export interface ProfileStatusBadgeProps {
  lagoSynced: boolean;
  error?: string | null;
}

export function ProfileStatusBadge(
  { lagoSynced, error }: ProfileStatusBadgeProps,
) {
  if (error) {
    return (
      <StatusBadge
        tone="warning"
        label="Lago mirror pending"
        title={error}
        icon={<AlertTriangle class="size-3" />}
      />
    );
  }
  if (lagoSynced) {
    return (
      <StatusBadge
        tone="success"
        label="Synced"
        icon={<CheckCircle2 class="size-3" />}
      />
    );
  }
  return <StatusBadge tone="muted" label="Not saved" />;
}

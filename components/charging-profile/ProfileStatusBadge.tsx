/**
 * Phase P5 — ProfileStatusBadge
 *
 * Renders the current sync state of a charging profile. Emerald when the
 * Lago mirror is up to date, amber when the mirror is behind with an error.
 */

import { Badge } from "@/components/ui/badge.tsx";
import { AlertTriangle, CheckCircle2 } from "lucide-preact";

export interface ProfileStatusBadgeProps {
  lagoSynced: boolean;
  error?: string | null;
}

export function ProfileStatusBadge(
  { lagoSynced, error }: ProfileStatusBadgeProps,
) {
  if (error) {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/60 text-amber-700 dark:text-amber-400"
        title={error}
      >
        <AlertTriangle className="size-3" aria-hidden="true" />
        Lago mirror pending
      </Badge>
    );
  }
  if (lagoSynced) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-500/60 text-emerald-700 dark:text-emerald-400"
      >
        <CheckCircle2 className="size-3" aria-hidden="true" />
        Synced
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Not saved
    </Badge>
  );
}

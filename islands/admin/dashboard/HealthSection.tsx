/**
 * HealthSection — semantic warning rollups. Pure props on first render; on
 * mount it polls /api/admin/dashboard/overview every 30s so the page can sit
 * open all afternoon and still reflect drift in charger health, breaker
 * state, etc. without operator interaction.
 */

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
  Activity,
  AlertTriangle,
  PlugZap,
  Receipt,
  ShieldAlert,
  Smartphone,
} from "lucide-preact";
import { MetricTile } from "@/components/shared/MetricTile.tsx";
import type { AccentColor } from "@/src/lib/colors.ts";

export interface HealthDTO {
  chargersOfflineGt1h: number;
  chargersDim10mTo1h: number;
  failedSyncs24h: number;
  overdueInvoices: number;
  breakerOpen: boolean;
  devicesOfflineGt1h: number;
}

interface Props {
  initial: HealthDTO;
  /** Poll interval in ms; 0 disables polling. */
  pollMs?: number;
}

function tone(value: number, warnAt = 1, errorAt = 5): AccentColor {
  if (value >= errorAt) return "rose";
  if (value >= warnAt) return "amber";
  return "slate";
}

export default function HealthSection({ initial, pollMs = 30_000 }: Props) {
  const data = useSignal<HealthDTO>(initial);

  useEffect(() => {
    if (pollMs <= 0) return;
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const res = await fetch("/api/admin/dashboard/overview", {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const body = await res.json() as { health?: HealthDTO };
        if (!cancelled && body.health) data.value = body.health;
      } catch {
        // swallow — next tick will retry
      }
    };
    const handle = setInterval(fetchOnce, pollMs);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [pollMs]);

  const h = data.value;

  return (
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <MetricTile
        icon={PlugZap}
        label="Chargers offline >1h"
        value={h.chargersOfflineGt1h}
        accent={tone(h.chargersOfflineGt1h)}
        size="sm"
      />
      <MetricTile
        icon={Activity}
        label="Failed syncs (24h)"
        value={h.failedSyncs24h}
        accent={tone(h.failedSyncs24h)}
        size="sm"
      />
      <MetricTile
        icon={Receipt}
        label="Overdue invoices"
        value={h.overdueInvoices}
        accent={h.overdueInvoices > 0 ? "amber" : "slate"}
        size="sm"
      />
      <MetricTile
        icon={ShieldAlert}
        label="Webhook breaker"
        value={h.breakerOpen ? "OPEN" : "Closed"}
        accent={h.breakerOpen ? "rose" : "slate"}
        size="sm"
      />
      <MetricTile
        icon={Smartphone}
        label="Devices offline >1h"
        value={h.devicesOfflineGt1h}
        accent={h.devicesOfflineGt1h > 0 ? "amber" : "slate"}
        size="sm"
      />
      <MetricTile
        icon={AlertTriangle}
        label="Chargers dim (10m–1h)"
        value={h.chargersDim10mTo1h}
        accent={h.chargersDim10mTo1h > 0 ? "amber" : "slate"}
        size="sm"
      />
    </div>
  );
}

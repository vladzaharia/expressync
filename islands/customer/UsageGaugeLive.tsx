/**
 * UsageGaugeLive — customer Billing usage gauge with optional SSE refresh.
 *
 * Polaris Track G — wraps the canonical `UsageGauge` shared component and
 * subscribes (best-effort) to `transaction.meter` SSE events so the gauge
 * ticks up when a session in flight reports new kWh. SSE is non-essential:
 * the gauge always renders the server-provided initial value, and the
 * effect just nudges the value upward when push events arrive.
 *
 * For MVP we keep the SSE wiring minimal — listen for `transaction.meter`
 * payloads with a `userMappingId` matching the active scope and add the
 * deltaKwh to the in-memory ratio. Background-fetching the full usage
 * payload is left to a follow-up so we don't churn the Lago client on
 * every meter tick.
 */

import { useEffect, useState } from "preact/hooks";
import { UsageGauge } from "@/components/shared/UsageGauge.tsx";
import { subscribeSse } from "@/islands/shared/SseProvider.tsx";
import type { AccentColor } from "@/src/lib/colors.ts";

interface Props {
  initialValueKwh: number;
  capKwh: number | null;
  caption?: string;
  /** Accent override for the gauge (e.g. "teal" on Billing). */
  accent?: AccentColor;
  /** mapping ids the user owns; events outside this set are ignored. */
  mappingIds?: number[];
}

/**
 * Coerce a string-or-number to a finite number, defaulting to 0. Used to
 * tolerate the units field on `LagoCurrentUsage.charges_usage` which is a
 * string per the OpenAPI spec.
 */
function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export default function UsageGaugeLive(
  { initialValueKwh, capKwh, caption, accent = "teal", mappingIds = [] }: Props,
) {
  const [value, setValue] = useState<number>(initialValueKwh);

  useEffect(() => {
    // Reset whenever the loader-provided value changes (period switch, etc).
    setValue(initialValueKwh);
  }, [initialValueKwh]);

  useEffect(() => {
    if (mappingIds.length === 0) return;
    const ownedSet = new Set(mappingIds);
    const unsub = subscribeSse("transaction.meter", (payload) => {
      const p = payload as
        | {
          userMappingId?: number;
          deltaKwh?: number | string;
          totalKwh?: number | string;
        }
        | null;
      if (!p) return;
      if (
        typeof p.userMappingId === "number" &&
        !ownedSet.has(p.userMappingId)
      ) {
        return;
      }
      // Prefer deltaKwh (additive); fall back to absolute totalKwh if the
      // payload only carries the cumulative value for the active session.
      const delta = toNumber(p.deltaKwh);
      if (delta > 0) {
        setValue((prev) => prev + delta);
        return;
      }
      const total = toNumber(p.totalKwh);
      if (total > value) setValue(total);
    });
    return () => unsub();
  }, [mappingIds.join(",")]);

  return (
    <UsageGauge
      value={value}
      cap={capKwh}
      unit="kWh"
      caption={caption}
      accent={accent}
    />
  );
}

/**
 * Two admin-only dropdowns for the connector spec overrides on a
 * charger: connector type ({ccs, j1772, nacs, chademo, type2}) and
 * the AC/DC kW rating. StEvE doesn't reliably surface either field
 * on every model — these overrides let an operator pin the canonical
 * values so the iOS detail screen and the web admin card render
 * what's actually installed.
 *
 * Both selects PATCH `/api/admin/charger/{chargeBoxId}` and reload
 * the page on success so the cached SSR view picks up the change.
 */

import { useState } from "preact/hooks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";

const NULL_OPTION = "__null__";

const CONNECTOR_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: NULL_OPTION, label: "— Auto / unset —" },
  { value: "j1772", label: "J1772 (Type 1, AC)" },
  { value: "type2", label: "Type 2 / Mennekes (AC)" },
  { value: "nacs", label: "NACS / J3400 (Tesla)" },
  { value: "ccs", label: "CCS Combo" },
  { value: "chademo", label: "CHAdeMO" },
];

/** North-American EV charger ratings. Single-phase 120 V (Level 1),
 *  single-phase 240 V (Level 2), and CCS/NACS DC-fast tiers as seen
 *  in the wild from ChargePoint, Wallbox, JuiceBox, Tesla, EA, EVgo.
 *  Sorted by power so the dropdown reads from "trickle" up to
 *  "ultra-fast". */
const KW_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: NULL_OPTION, label: "— Auto / unset —" },
  // Level 1 — 120 V
  { value: "1.4", label: "1.4 kW (Level 1, 12 A @ 120 V)" },
  // Level 2 — 240 V single-phase
  { value: "3.8", label: "3.8 kW (Level 2, 16 A @ 240 V)" },
  { value: "5.8", label: "5.8 kW (Level 2, 24 A @ 240 V)" },
  { value: "7.2", label: "7.2 kW (Level 2, 30 A @ 240 V)" },
  { value: "7.7", label: "7.7 kW (Level 2, 32 A @ 240 V)" },
  { value: "9.6", label: "9.6 kW (Level 2, 40 A @ 240 V)" },
  { value: "11.5", label: "11.5 kW (Level 2, 48 A @ 240 V)" },
  { value: "19.2", label: "19.2 kW (Level 2, 80 A @ 240 V)" },
  // DC fast (CCS / NACS)
  { value: "50", label: "50 kW (DC fast)" },
  { value: "100", label: "100 kW (DC fast)" },
  { value: "150", label: "150 kW (DC fast)" },
  { value: "175", label: "175 kW (DC fast)" },
  { value: "250", label: "250 kW (DC ultra-fast)" },
  { value: "350", label: "350 kW (DC ultra-fast)" },
];

interface Props {
  chargeBoxId: string;
  /** Current `connector_type_override`; `null` when no override set. */
  connectorTypeOverride: string | null;
  /** Current `max_kw_override`; `null` when no override set. */
  maxKwOverride: number | null;
}

export default function ChargerConnectorOverrideSelect(
  { chargeBoxId, connectorTypeOverride, maxKwOverride }: Props,
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectorValue, setConnectorValue] = useState<string>(
    connectorTypeOverride ?? NULL_OPTION,
  );
  const [kwValue, setKwValue] = useState<string>(
    maxKwOverride !== null ? String(maxKwOverride) : NULL_OPTION,
  );

  const patch = async (body: Record<string, unknown>) => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/charger/${encodeURIComponent(chargeBoxId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      if (typeof globalThis !== "undefined" && "location" in globalThis) {
        (globalThis as { location: Location }).location.reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setPending(false);
    }
  };

  const onConnectorChange = async (next: string) => {
    if (next === connectorValue || pending) return;
    setConnectorValue(next);
    await patch({
      connectorTypeOverride: next === NULL_OPTION ? null : next,
    });
  };

  const onKwChange = async (next: string) => {
    if (next === kwValue || pending) return;
    setKwValue(next);
    await patch({
      maxKwOverride: next === NULL_OPTION ? null : Number(next),
    });
  };

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <dt class="text-muted-foreground text-sm">Connector type</dt>
        <dd>
          <Select
            value={connectorValue}
            onValueChange={onConnectorChange}
            disabled={pending}
          >
            <SelectTrigger class="h-8 w-56 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONNECTOR_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </dd>
      </div>

      <div class="flex items-center justify-between gap-2">
        <dt class="text-muted-foreground text-sm">Max kW</dt>
        <dd>
          <Select
            value={kwValue}
            onValueChange={onKwChange}
            disabled={pending}
          >
            <SelectTrigger class="h-8 w-56 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KW_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </dd>
      </div>

      {error && <span class="text-xs text-rose-500 self-end">{error}</span>}
    </div>
  );
}

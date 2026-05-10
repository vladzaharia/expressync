/**
 * Inline create form for `+ Add connector`. Renders above the connector
 * grid when activated. Three fields: connectorId (number, prefilled
 * with `max(existingId)+1`, editable), connector type, max kW.
 */

import { useState } from "preact/hooks";
import { Button } from "@/components/ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  CONNECTOR_TYPE_LABELS,
  CONNECTOR_TYPES,
  KW_PRESETS,
} from "@/src/lib/types/connectors.ts";

const NULL_VALUE = "__null__";

interface Props {
  chargeBoxId: string;
  suggestedConnectorId: number;
  existingConnectorIds: number[];
  onCancel: () => void;
}

export default function ConnectorCreateRow(
  { chargeBoxId, suggestedConnectorId, existingConnectorIds, onCancel }: Props,
) {
  const [connectorIdRaw, setConnectorIdRaw] = useState(
    suggestedConnectorId.toString(),
  );
  const [connectorType, setConnectorType] = useState<string>(NULL_VALUE);
  const [maxKw, setMaxKw] = useState<string>(NULL_VALUE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateConnectorId = (): number | null => {
    const num = Number(connectorIdRaw);
    if (!Number.isInteger(num) || num < 0 || num > 9999) return null;
    return num;
  };

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    setError(null);

    const connectorId = validateConnectorId();
    if (connectorId === null) {
      setError("Connector number must be a non-negative integer ≤ 9999");
      return;
    }
    if (existingConnectorIds.includes(connectorId)) {
      setError(`Connector ${connectorId} already exists on this charger`);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/charger/${chargeBoxId}/connectors`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connectorId,
            connectorType: connectorType === NULL_VALUE ? null : connectorType,
            maxKw: maxKw === NULL_VALUE ? null : Number(maxKw),
          }),
        },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`);
      }
      globalThis.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      class="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 p-3"
      aria-label="Add connector"
    >
      <div class="flex flex-col gap-1">
        <label
          for="new-connector-id"
          class="text-xs uppercase tracking-wide text-muted-foreground"
        >
          Connector #
        </label>
        <input
          id="new-connector-id"
          type="number"
          min={0}
          max={9999}
          step={1}
          value={connectorIdRaw}
          disabled={saving}
          onInput={(e) =>
            setConnectorIdRaw((e.target as HTMLInputElement).value)}
          class="h-8 w-20 rounded border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs uppercase tracking-wide text-muted-foreground">
          Type
        </label>
        <Select
          value={connectorType}
          onValueChange={(v: string) => setConnectorType(v)}
          disabled={saving}
        >
          <SelectTrigger class="h-8 w-[14rem] text-sm">
            <SelectValue placeholder="— Auto / unset —" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NULL_VALUE}>— Auto / unset —</SelectItem>
            {CONNECTOR_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {CONNECTOR_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs uppercase tracking-wide text-muted-foreground">
          Max kW
        </label>
        <Select
          value={maxKw}
          onValueChange={(v: string) => setMaxKw(v)}
          disabled={saving}
        >
          <SelectTrigger class="h-8 w-[14rem] text-sm">
            <SelectValue placeholder="— Auto / unset —" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NULL_VALUE}>— Auto / unset —</SelectItem>
            {KW_PRESETS.map((k) => (
              <SelectItem key={k.value} value={k.value.toString()}>
                {k.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div class="ml-auto flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Adding…" : "Add"}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          class="basis-full rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-700 dark:text-rose-300"
        >
          {error}
        </div>
      )}
    </form>
  );
}

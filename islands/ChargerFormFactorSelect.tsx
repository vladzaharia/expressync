import { useState } from "preact/hooks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";

interface Props {
  chargeBoxId: string;
  value: string;
  options: string[];
}

/**
 * Admin-only dropdown to change a charger's `form_factor`.
 *
 * PATCHes `/api/charger/{chargeBoxId}` with `{ formFactor }`. On success,
 * reloads the page so the detail SVG/icons re-render from the fresh server
 * state (keeps the island tiny; no need to mirror the form-factor icon map
 * over the network).
 */
export default function ChargerFormFactorSelect(
  { chargeBoxId, value, options }: Props,
) {
  const [pending, setPending] = useState(false);
  const [current, setCurrent] = useState(value);
  const [error, setError] = useState<string | null>(null);

  const onChange = async (next: string) => {
    if (next === current || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/charger/${encodeURIComponent(chargeBoxId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ formFactor: next }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      setCurrent(next);
      // Trigger a full page reload so the hero SVG re-renders.
      if (typeof globalThis !== "undefined" && "location" in globalThis) {
        (globalThis as { location: Location }).location.reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="inline-flex items-center gap-2">
      <Select value={current} onValueChange={onChange} disabled={pending}>
        <SelectTrigger class="h-8 w-40 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <span class="text-xs text-rose-500">{error}</span>}
    </div>
  );
}

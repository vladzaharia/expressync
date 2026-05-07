/**
 * DeviceLabelInput — admin-editable label row for the device identity
 * card. Mirrors `ChargerFormFactorSelect` in spirit: a single inline
 * input that PATCHes the rename endpoint and reloads on success.
 *
 * Wired to `POST /api/admin/devices/{deviceId}/rename` (existing route
 * since Wave 2 Track B-admin). Submits on blur or `Enter`.
 */

import { useState } from "preact/hooks";
import { Check, Loader2 } from "lucide-preact";
import { Input } from "@/components/ui/input.tsx";
import { toast } from "sonner";

interface Props {
  deviceId: string;
  value: string;
}

export default function DeviceLabelInput({ deviceId, value }: Props) {
  const [draft, setDraft] = useState(value);
  const [pending, setPending] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const dirty = draft.trim() !== value.trim() && draft.trim().length > 0;

  const submit = async () => {
    if (!dirty || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/devices/${encodeURIComponent(deviceId)}/rename`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: draft.trim() }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body.reason || body.error || `HTTP ${res.status}`;
        setError(msg);
        toast.error(`Rename failed: ${msg}`);
        return;
      }
      setSavedAt(Date.now());
      toast.success("Device renamed");
      // Reload so the page title + header strip pick up the new label.
      globalThis.location.reload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(`Rename failed: ${msg}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="inline-flex w-full items-center gap-2">
      <Input
        class="h-8 w-44 text-xs"
        value={draft}
        disabled={pending}
        maxLength={120}
        onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
        onBlur={submit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
      />
      {pending
        ? <Loader2 class="size-3.5 animate-spin text-muted-foreground" />
        : savedAt > 0 && Date.now() - savedAt < 2000
        ? <Check class="size-3.5 text-emerald-500" />
        : null}
      {error && <span class="text-xs text-rose-500">{error}</span>}
    </div>
  );
}

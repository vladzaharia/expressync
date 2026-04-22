/**
 * ReserveNowDialog — reserve a connector for a specific idTag until a
 * future time. Default expiry = now + 30m (editable). `connectorId` is
 * hidden and injected as 1.
 */

import { useEffect, useState } from "preact/hooks";
import { toast } from "sonner";
import { Timer } from "lucide-preact";
import { ActionDialog } from "./ActionDialog.tsx";
import { TagPickerCombobox } from "./TagPickerCombobox.tsx";
import {
  CONNECTOR_INJECTION,
  type PerDialogProps,
  submitOperation,
} from "./types.ts";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";

function localIsoInMinutes(offsetMin: number): string {
  const d = new Date(Date.now() + offsetMin * 60_000);
  // datetime-local needs `YYYY-MM-DDTHH:mm` in local tz.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${
    pad(d.getHours())
  }:${pad(d.getMinutes())}`;
}

export default function ReserveNowDialog(props: PerDialogProps) {
  const { chargeBoxId, isOpen, onClose, onResult } = props;
  const [idTag, setIdTag] = useState("");
  const [expiry, setExpiry] = useState<string>(localIsoInMinutes(30));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) setExpiry(localIsoInMinutes(30));
  }, [isOpen]);

  const handleConfirm = async () => {
    if (!idTag) {
      setError("Select an OCPP tag.");
      return;
    }
    if (!expiry) {
      setError("Pick an expiry time.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // datetime-local → ISO-8601 with timezone.
      const expiryIso = new Date(expiry).toISOString();
      const result = await submitOperation({
        chargeBoxId,
        operation: "ReserveNow",
        params: {
          connectorId: CONNECTOR_INJECTION.ReserveNow,
          expiry: expiryIso,
          idTag,
        },
      });
      toast.success("ReserveNow submitted");
      onResult(result);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`ReserveNow failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ActionDialog
      icon={Timer}
      title="Reserve connector"
      description="Reserve the connector for a specific OCPP tag until a future time."
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      isLoading={submitting}
      errorText={error}
      confirmLabel="Reserve"
      confirmDisabled={!idTag || !expiry}
    >
      <TagPickerCombobox value={idTag} onChange={setIdTag} required autoFocus />
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="rn-expiry">Expires at</Label>
        <Input
          id="rn-expiry"
          type="datetime-local"
          value={expiry}
          onInput={(e) =>
            setExpiry((e.currentTarget as HTMLInputElement).value)}
        />
        <p class="text-[11px] text-muted-foreground">
          Defaults to 30 minutes from now.
        </p>
      </div>
    </ActionDialog>
  );
}

/**
 * GetDiagnosticsDialog — asks the charger to upload diagnostics bundle to
 * the given URL. No `connectorId` field.
 */

import { useState } from "preact/hooks";
import { toast } from "sonner";
import { Download } from "lucide-preact";
import { ActionDialog } from "./ActionDialog.tsx";
import { type PerDialogProps, submitOperation } from "./types.ts";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";

export default function GetDiagnosticsDialog(props: PerDialogProps) {
  const { chargeBoxId, isOpen, onClose, onResult } = props;
  const [location, setLocation] = useState("");
  const [retries, setRetries] = useState("");
  const [retryInterval, setRetryInterval] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!location.trim()) {
      setError("Upload URL is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const params: Record<string, unknown> = { location: location.trim() };
      const r = Number(retries);
      if (Number.isFinite(r) && r >= 1) params.retries = r;
      const ri = Number(retryInterval);
      if (Number.isFinite(ri) && ri >= 1) params.retryInterval = ri;
      const result = await submitOperation({
        chargeBoxId,
        operation: "GetDiagnostics",
        params,
      });
      toast.success("GetDiagnostics submitted");
      onResult(result);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`GetDiagnostics failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ActionDialog
      icon={Download}
      title="Get diagnostics"
      description="Ask the charger to upload a diagnostics bundle to the given URL."
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      isLoading={submitting}
      errorText={error}
      confirmLabel="Request diagnostics"
      confirmDisabled={!location.trim()}
    >
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="gd-loc">Upload URL</Label>
        <Input
          id="gd-loc"
          value={location}
          placeholder="ftp://user:pass@host/path/"
          onInput={(e) =>
            setLocation((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="gd-retries">Retries (optional)</Label>
        <Input
          id="gd-retries"
          type="number"
          min={1}
          value={retries}
          onInput={(e) =>
            setRetries((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="gd-interval">
          Retry interval (seconds, optional)
        </Label>
        <Input
          id="gd-interval"
          type="number"
          min={1}
          value={retryInterval}
          onInput={(e) =>
            setRetryInterval((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
    </ActionDialog>
  );
}

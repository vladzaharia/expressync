/**
 * RemoteStartDialog — initiates a RemoteStartTransaction.
 *
 * UI rules:
 *   - `idTag` is picked via `TagPickerCombobox` (no freeform text).
 *   - `connectorId` is hidden; the submit payload injects `1` per the
 *     single-connector deployment convention (see `types.ts`).
 *   - On open, we fetch `/api/admin/charger/{chargeBoxId}/recent-tag` and
 *     pre-select the returned idTag when present.
 */

import { useEffect, useState } from "preact/hooks";
import { toast } from "sonner";
import { Play } from "lucide-preact";
import { ActionDialog } from "./ActionDialog.tsx";
import { TagPickerCombobox } from "./TagPickerCombobox.tsx";
import {
  CONNECTOR_INJECTION,
  type PerDialogProps,
  submitOperation,
} from "./types.ts";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";

export default function RemoteStartDialog(props: PerDialogProps) {
  const { chargeBoxId, prefill, isOpen, onClose, onResult } = props;
  const [idTag, setIdTag] = useState<string>(
    typeof prefill.idTag === "string" ? prefill.idTag : "",
  );
  const [chargingProfilePk, setChargingProfilePk] = useState<string>(
    prefill.chargingProfilePk ? String(prefill.chargingProfilePk) : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-select most-recent tag for this charger when opening.
  useEffect(() => {
    if (!isOpen || idTag) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/admin/charger/${encodeURIComponent(chargeBoxId)}/recent-tag`,
        );
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && typeof json.idTag === "string" && json.idTag) {
          setIdTag(json.idTag);
        }
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleConfirm = async () => {
    if (!idTag) {
      setError("Select an OCPP tag first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {
        idTag,
        connectorId: CONNECTOR_INJECTION.RemoteStartTransaction,
      };
      const pk = Number(chargingProfilePk);
      if (Number.isFinite(pk) && pk > 0) params.chargingProfilePk = pk;
      const result = await submitOperation({
        chargeBoxId,
        operation: "RemoteStartTransaction",
        params,
      });
      toast.success("RemoteStart submitted");
      onResult(result);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`RemoteStart failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ActionDialog
      icon={Play}
      title="Start transaction"
      description="Send a RemoteStartTransaction so the charger begins charging under the selected OCPP tag."
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      isLoading={submitting}
      errorText={error}
      confirmLabel="Start transaction"
      confirmDisabled={!idTag}
    >
      <TagPickerCombobox
        value={idTag}
        onChange={setIdTag}
        required
        autoFocus
      />
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="rs-profile-pk">
          Charging profile PK (optional)
        </Label>
        <Input
          id="rs-profile-pk"
          type="number"
          min={1}
          value={chargingProfilePk}
          onInput={(e) =>
            setChargingProfilePk((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
    </ActionDialog>
  );
}

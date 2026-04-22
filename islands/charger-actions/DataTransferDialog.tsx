/**
 * DataTransferDialog — OEM-specific DataTransfer. Retains the type-to-confirm
 * phrase gate ("DATA TRANSFER") because vendor semantics vary widely and a
 * wrong dispatch can misconfigure the charger. No `connectorId` field.
 */

import { useEffect, useState } from "preact/hooks";
import { toast } from "sonner";
import { Send } from "lucide-preact";
import { ActionDialog } from "./ActionDialog.tsx";
import { type PerDialogProps, submitOperation } from "./types.ts";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";

const CONFIRM_PHRASE = "DATA TRANSFER";

export default function DataTransferDialog(props: PerDialogProps) {
  const { chargeBoxId, isOpen, onClose, onResult } = props;
  const [vendorId, setVendorId] = useState("");
  const [messageId, setMessageId] = useState("");
  const [data, setData] = useState("");
  const [phrase, setPhrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setPhrase("");
      setError(null);
    }
  }, [isOpen]);

  const phraseOk = phrase === CONFIRM_PHRASE;

  const handleConfirm = async () => {
    if (!vendorId.trim()) {
      setError("Vendor ID is required.");
      return;
    }
    if (!phraseOk) {
      setError(`Type ${CONFIRM_PHRASE} to confirm.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const params: Record<string, unknown> = { vendorId: vendorId.trim() };
      if (messageId.trim()) params.messageId = messageId.trim();
      if (data.trim()) params.data = data.trim();
      const result = await submitOperation({
        chargeBoxId,
        operation: "DataTransfer",
        params,
      });
      toast.success("DataTransfer submitted");
      onResult(result);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`DataTransfer failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ActionDialog
      icon={Send}
      title="Data transfer"
      description="OEM-specific DataTransfer. Vendor semantics vary — confirm carefully."
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      isLoading={submitting}
      errorText={error}
      confirmLabel="Send data transfer"
      confirmVariant="destructive"
      confirmDisabled={!vendorId.trim() || !phraseOk}
    >
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="dt-vendor">Vendor ID</Label>
        <Input
          id="dt-vendor"
          value={vendorId}
          onInput={(e) =>
            setVendorId((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="dt-message">Message ID (optional)</Label>
        <Input
          id="dt-message"
          value={messageId}
          onInput={(e) =>
            setMessageId((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="dt-data">Payload (optional)</Label>
        <textarea
          id="dt-data"
          class="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={data}
          onInput={(e) =>
            setData((e.currentTarget as HTMLTextAreaElement).value)}
        />
      </div>
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="dt-phrase">
          Type <code class="font-mono font-semibold">{CONFIRM_PHRASE}</code>
          {" "}
          to confirm
        </Label>
        <Input
          id="dt-phrase"
          value={phrase}
          autoComplete="off"
          spellcheck={false}
          onInput={(e) =>
            setPhrase((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
    </ActionDialog>
  );
}

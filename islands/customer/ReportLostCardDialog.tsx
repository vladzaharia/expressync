/**
 * ReportLostCardDialog — replaces the previous "mailto:" stopgap on
 * /cards/[id]. Confirms intent, optionally captures a free-text reason,
 * and POSTs to /api/customer/cards/[id]/report-lost.
 *
 * On success: navigate to /cards (the just-deactivated card will appear
 * inactive in the list). On error: surface the message inline + leave
 * the dialog open so the customer can retry.
 */

import { useSignal } from "@preact/signals";
import { Mail } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import ConfirmDialog from "@/components/shared/ConfirmDialog.tsx";
import { clientNavigate } from "@/src/lib/nav.ts";
import { toast } from "sonner";

interface Props {
  cardId: number;
  cardName: string;
  /** Mailto fallback when the customer prefers to email instead. */
  operatorEmail: string;
}

export default function ReportLostCardDialog(
  { cardId, cardName, operatorEmail }: Props,
) {
  const open = useSignal(false);
  const reason = useSignal("");
  const submitting = useSignal(false);
  const errorMsg = useSignal<string | null>(null);

  const submit = async () => {
    submitting.value = true;
    errorMsg.value = null;
    try {
      const res = await fetch(`/api/customer/cards/${cardId}/report-lost`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.value.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      toast.success("Card reported as lost", {
        description: "Your card is now inactive — it can't authorize a charge.",
        duration: 5000,
      });
      open.value = false;
      // Refresh the page so the inactive state is reflected immediately.
      clientNavigate("/cards");
    } catch (err) {
      errorMsg.value = err instanceof Error
        ? err.message
        : "Couldn't report the card. Try again or email support.";
    } finally {
      submitting.value = false;
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="mobile"
        onClick={() => {
          errorMsg.value = null;
          open.value = true;
        }}
      >
        <Mail class="size-4" />
        Report lost
      </Button>
      <ConfirmDialog
        open={open.value}
        onOpenChange={(next) => (open.value = next)}
        title="Report this card as lost?"
        description={
          <div class="space-y-3">
            <p>
              We'll deactivate{" "}
              <span class="font-medium">{cardName}</span>{" "}
              right away so it can't start a new charging session. An admin
              will be notified to issue a replacement.
            </p>
            <label class="block text-sm">
              <span class="text-muted-foreground">
                Optional context (helps the operator follow up)
              </span>
              <textarea
                class="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm"
                rows={3}
                maxLength={280}
                value={reason.value}
                onInput={(e) =>
                  (reason.value = (e.currentTarget as HTMLTextAreaElement).value)}
                placeholder="Where did you lose it? Any details that might help…"
              />
            </label>
            {errorMsg.value && (
              <p class="text-sm text-destructive">{errorMsg.value}</p>
            )}
            <p class="text-xs text-muted-foreground">
              Prefer email? Write to{" "}
              <a class="underline" href={`mailto:${operatorEmail}`}>
                {operatorEmail}
              </a>{" "}
              instead.
            </p>
          </div>
        }
        variant="destructive"
        confirmLabel="Deactivate card"
        onConfirm={submit}
        isLoading={submitting.value}
      />
    </>
  );
}

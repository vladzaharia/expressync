import { useSignal } from "@preact/signals";
import type { LucideIcon } from "lucide-preact";
import { CreditCard, Gift, MinusCircle } from "lucide-preact";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import {
  IconEVCard,
  IconKeytag,
  IconSticker,
  type TagIconProps,
} from "@/components/brand/tags/index.ts";

type BillingMode = "charged" | "no_cost" | "skipped_sync";
type CardType = "ev_card" | "keytag" | "sticker";

interface IssueCardDialogProps {
  /** Mapping we're issuing the card against. */
  userMappingId: number;
  /** Display label for the user / mapping, used in the dialog title. */
  mappingLabel?: string | null;
  /** Whether the mapping has a Lago customer linked — disables Lago modes if not. */
  hasLagoCustomer: boolean;
  /** Controlled open state. */
  open: boolean;
  /** Close handler. */
  onOpenChange: (open: boolean) => void;
  /** Optional callback after a successful issuance. */
  onIssued?: (result: {
    issuedCardId: number;
    billingMode: BillingMode;
    syncError: string | null;
  }) => void;
}

interface ModeOption {
  value: BillingMode;
  label: string;
  hint: string;
  icon: LucideIcon;
  disabledReason?: string;
}

interface CardTypeOption {
  value: CardType;
  label: string;
  icon: preact.ComponentType<TagIconProps>;
  textClass: string;
}

const CARD_TYPE_OPTIONS: CardTypeOption[] = [
  {
    value: "ev_card",
    label: "EV Card",
    icon: IconEVCard,
    textClass: "text-blue-500",
  },
  {
    value: "keytag",
    label: "Keytag",
    icon: IconKeytag,
    textClass: "text-emerald-500",
  },
  {
    value: "sticker",
    label: "Sticker",
    icon: IconSticker,
    textClass: "text-rose-500",
  },
];

export default function IssueCardDialog(props: IssueCardDialogProps) {
  const mode = useSignal<BillingMode>("charged");
  const cardType = useSignal<CardType>("ev_card");
  const note = useSignal("");
  const submitting = useSignal(false);
  const errorMessage = useSignal<string | null>(null);

  const options: ModeOption[] = [
    {
      value: "charged",
      label: "Charged",
      hint: "Customer pays $3 on the next invoice.",
      icon: CreditCard,
      disabledReason: props.hasLagoCustomer
        ? undefined
        : "Mapping has no Lago customer linked.",
    },
    {
      value: "no_cost",
      label: "No Cost",
      hint: "Invoice logged with the Free Card coupon — nets to $0.",
      icon: Gift,
      disabledReason: props.hasLagoCustomer
        ? undefined
        : "Mapping has no Lago customer linked.",
    },
    {
      value: "skipped_sync",
      label: "Skipped Sync",
      hint: "Local audit row only. Nothing is sent to Lago.",
      icon: MinusCircle,
    },
  ];

  const handleSubmit = async () => {
    if (submitting.value) return;
    submitting.value = true;
    errorMessage.value = null;
    try {
      const res = await fetch("/api/mapping/issue-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userMappingId: props.userMappingId,
          cardType: cardType.value,
          billingMode: mode.value,
          note: note.value.trim() === "" ? undefined : note.value.trim(),
        }),
      });
      const json = await res.json().catch(
        () => ({} as Record<string, unknown>),
      );
      if (!res.ok && res.status !== 207) {
        errorMessage.value = typeof json.error === "string"
          ? json.error
          : `Request failed (${res.status})`;
        return;
      }
      const syncError = typeof json.syncError === "string"
        ? json.syncError
        : null;
      const issuedCardId = typeof json.issuedCardId === "number"
        ? json.issuedCardId
        : 0;
      props.onIssued?.({
        issuedCardId,
        billingMode: mode.value,
        syncError,
      });
      // Partial success — the local row was written but Lago failed.
      if (syncError) {
        errorMessage.value =
          `Card recorded locally, but Lago sync failed: ${syncError}. You can retry from the card history.`;
      } else {
        // Close on full success.
        props.onOpenChange(false);
        mode.value = "charged";
        cardType.value = "ev_card";
        note.value = "";
      }
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : String(err);
    } finally {
      submitting.value = false;
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onClose={() => props.onOpenChange(false)}
      >
        <DialogHeader>
          <DialogTitle>
            Issue EV Card
            {props.mappingLabel
              ? (
                <span class="ml-2 text-sm font-normal text-muted-foreground">
                  {props.mappingLabel}
                </span>
              )
              : null}
          </DialogTitle>
        </DialogHeader>

        <div class="space-y-4 py-2">
          <div class="space-y-2">
            <Label>Card type</Label>
            <div class="grid grid-cols-3 gap-2">
              {CARD_TYPE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const selected = cardType.value === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => (cardType.value = opt.value)}
                    disabled={submitting.value}
                    aria-pressed={selected}
                    class={cn(
                      "flex flex-col items-center justify-center gap-2 rounded-md border px-3 py-4 text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <Icon
                      size="lg"
                      class={cn(
                        "shrink-0",
                        selected ? opt.textClass : "text-muted-foreground",
                      )}
                    />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div class="space-y-2">
            <Label>Billing mode</Label>
            <ToggleGroup
              type="single"
              variant="outline-joined"
              value={mode.value}
              onValueChange={(v: string) => {
                if (
                  v === "charged" || v === "no_cost" || v === "skipped_sync"
                ) {
                  mode.value = v;
                }
              }}
              class="w-full"
            >
              {options.map((opt) => {
                const Icon = opt.icon;
                const disabled = !!opt.disabledReason;
                return (
                  <ToggleGroupItem
                    key={opt.value}
                    value={opt.value}
                    class="flex-1"
                    disabled={disabled}
                    title={opt.disabledReason ?? opt.hint}
                    aria-label={opt.label}
                  >
                    <Icon class="mr-2 h-4 w-4" />
                    {opt.label}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
            <p
              class={cn(
                "text-xs text-muted-foreground",
                submitting.value && "opacity-50",
              )}
            >
              {options.find((o) => o.value === mode.value)?.hint}
            </p>
          </div>

          <div class="space-y-2">
            <Label for="issue-card-note">Note (optional)</Label>
            <textarea
              id="issue-card-note"
              value={note.value}
              onInput={(
                e,
              ) => (note.value =
                (e.currentTarget as HTMLTextAreaElement).value)}
              disabled={submitting.value}
              placeholder="e.g. Replacement for lost card 001"
              class="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {errorMessage.value
            ? (
              <div class="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
                {errorMessage.value}
              </div>
            )
            : null}
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => props.onOpenChange(false)}
            disabled={submitting.value}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting.value}>
            {submitting.value ? "Issuing..." : "Issue Card"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

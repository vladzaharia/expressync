import { useSignal } from "@preact/signals";
import { CreditCard, Layers } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import IssueCardDialog from "./IssueCardDialog.tsx";

interface Props {
  userMappingId: number;
  /** Preferred label is display name; falls back to OCPP id tag. */
  mappingLabel?: string | null;
  /** When false, `Charged` and `No Cost` modes are disabled in the dialog. */
  hasLagoCustomer: boolean;
  /**
   * Meta-tags (OCPP-*) are hierarchy rollups, not physical cards. The server
   * rejects issuance against them with `mapping_is_meta_tag`, so the button
   * is hidden in favor of a disabled label.
   */
  isMeta?: boolean;
}

/**
 * Button + dialog island: drop into a PageCard's `headerActions` (or any
 * mapping-detail view) to issue a card against a mapping. Reloads the page
 * after a successful issuance so the server-side data (cards_issued count,
 * card history) reflects the new row without a manual refresh.
 */
export default function MappingIssueCardAction(props: Props) {
  const open = useSignal(false);

  if (props.isMeta) {
    return (
      <div
        class="flex items-center gap-2 rounded-md border border-dashed border-input bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground"
        title="Meta-tags are hierarchy rollups, not physical cards. Issue cards against individual child mappings."
      >
        <Layers class="h-3.5 w-3.5" />
        <span>Meta-tag</span>
      </div>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => (open.value = true)}
      >
        <CreditCard class="mr-2 h-4 w-4" />
        Issue Card
      </Button>
      <IssueCardDialog
        userMappingId={props.userMappingId}
        mappingLabel={props.mappingLabel}
        hasLagoCustomer={props.hasLagoCustomer}
        open={open.value}
        onOpenChange={(next) => (open.value = next)}
        onIssued={({ syncError }) => {
          // Only reload on clean success — on partial failure the dialog
          // surfaces its own error banner and the user can retry.
          if (!syncError) {
            globalThis.location.reload();
          }
        }}
      />
    </>
  );
}

/**
 * "Scan another for this customer" island on `/links/[id]`.
 *
 * Custom routing rules:
 *   - Scanned tag is ALREADY linked → /links/{mappingId}
 *   - Scanned tag exists but unlinked → /links/new?tagPk=…&customerId=…
 *   - Scanned tag is unknown → /tags/new?idTag=…
 *
 * Mounts the unified `<ScanModal>` directly so the route resolver can
 * encode the customer-context. The shared `<ScanModalHost>` only knows
 * default routing; flows that need custom routing pass it through here.
 */

import { useSignal } from "@preact/signals";
import { Button } from "@/components/ui/button.tsx";
import { Radio } from "lucide-preact";
import ScanModal from "@/islands/shared/ScanModal.tsx";
import { clientNavigate } from "@/src/lib/nav.ts";

interface Props {
  /** Lago customer external id — preserved on the redirect query string. */
  customerExternalId: string;
}

export default function ScanAnotherForCustomer({ customerExternalId }: Props) {
  const open = useSignal(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => (open.value = true)}
      >
        <Radio class="mr-2 size-4" />
        Scan another for this customer
      </Button>
      <ScanModal
        open={open.value}
        onOpenChange={(v) => (open.value = v)}
        mode="admin"
        purpose="lookup-tag"
        modalTitle="Link another tag"
        subtitle="Tap the customer's card on any online tappable device."
        resolve={{
          kind: "callback",
          fn: (r) => {
            if (r.exists && r.hasMapping && typeof r.mappingId === "number") {
              clientNavigate(`/links/${r.mappingId}`);
              return;
            }
            if (r.exists && typeof r.tagPk === "number") {
              const qs = new URLSearchParams({
                tagPk: String(r.tagPk),
                customerId: customerExternalId,
              });
              clientNavigate(`/links/new?${qs.toString()}`);
              return;
            }
            clientNavigate(`/tags/new?idTag=${encodeURIComponent(r.idTag)}`);
          },
        }}
      />
    </>
  );
}

/**
 * "Scan another for this customer" island on `/links/[id]`.
 *
 * Reuses `ScanTagAction` + `TapToAddModal` but overrides the default routing
 * so the scanned tag comes back into the linking flow with the customer
 * context preserved.
 *
 * Routing rules:
 *   - Scanned tag is ALREADY linked (any customer)  → `/links/{mappingId}`.
 *   - Scanned tag exists in StEvE but is unlinked    → `/links/new?tagPk=…&customerId=…`.
 *   - Scanned tag is unknown to StEvE                → `/tags/new?idTag=…` (they
 *     need to register it in StEvE + metadata first; linking picks up after).
 *
 * Uses the arm-intent pipeline (`/api/admin/tag/scan-arm`) — inherited from
 * `TapToAddModal`'s default — so this works for known AND unknown tags via
 * the SteVe pre-Authorize hook, not just the legacy log-scrape path.
 */

import ScanTagAction from "@/islands/ScanTagAction.tsx";
import type { ScanResult } from "@/islands/shared/use-scan-tag.ts";
import { clientNavigate } from "@/src/lib/nav.ts";

interface Props {
  /** Lago customer external id — passed through as `?customerId=` on the
   *  redirect when the scanned tag is existing-but-unlinked. */
  customerExternalId: string;
}

export default function ScanAnotherForCustomer({ customerExternalId }: Props) {
  const handleDetected = (r: ScanResult) => {
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
    // Unknown tag — send them through `/tags/new` to register it. The
    // customer context is preserved as a returnable search param on the
    // `/tags/new` page; today we just forward the idTag.
    clientNavigate(`/tags/new?idTag=${encodeURIComponent(r.idTag)}`);
  };

  return (
    <ScanTagAction
      buttonLabel="Scan another for this customer"
      onDetected={handleDetected}
      panelTitle="Link another tag"
      panelSubtitle="Tap the customer's card on any online charger."
    />
  );
}

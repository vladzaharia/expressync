/**
 * Full-width Connectors section. Renders the per-connector grid plus an
 * inline create row for adding a new connector. Standardised on
 * `SectionCard` after the 2026-05 redesign so it matches every other
 * detail-page section.
 */

import { useState } from "preact/hooks";
import { Plug, Plus } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { SectionCard } from "@/components/shared/SectionCard.tsx";
import { type AccentColor } from "@/src/lib/colors.ts";
import ConnectorCard, { type ConnectorDto } from "./ConnectorCard.tsx";
import ConnectorCreateRow from "./ConnectorCreateRow.tsx";

interface Props {
  chargeBoxId: string;
  connectors: ConnectorDto[];
  isAdmin: boolean;
  isUnmanaged: boolean;
  accent?: AccentColor;
}

export default function ConnectorsSection(
  { chargeBoxId, connectors, isAdmin, isUnmanaged, accent = "orange" }: Props,
) {
  const [adding, setAdding] = useState(false);

  const nextConnectorId = connectors.length === 0
    ? 1
    : Math.max(...connectors.map((c) => c.connectorId)) + 1;

  const actions = isAdmin
    ? (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setAdding((v) => !v)}
        aria-expanded={adding}
      >
        <Plus class="size-3.5" />
        {adding ? "Cancel" : "Add connector"}
      </Button>
    )
    : null;

  return (
    <SectionCard
      title="Connectors"
      description={`${connectors.length} ${
        connectors.length === 1 ? "connector" : "connectors"
      }`}
      icon={Plug}
      accent={accent}
      actions={actions}
    >
      <div class="flex flex-col gap-4">
        {adding && (
          <ConnectorCreateRow
            chargeBoxId={chargeBoxId}
            suggestedConnectorId={nextConnectorId}
            existingConnectorIds={connectors.map((c) => c.connectorId)}
            onCancel={() => setAdding(false)}
          />
        )}

        {connectors.length === 0
          ? (
            <div class="rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              No connectors yet. {isAdmin
                ? "Use “Add connector” above to create one."
                : "Once a connector is observed, it will appear here."}
            </div>
          )
          : (
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {connectors.map((c) => (
                <ConnectorCard
                  key={c.connectorId}
                  chargeBoxId={chargeBoxId}
                  connector={c}
                  isAdmin={isAdmin}
                  isUnmanaged={isUnmanaged}
                />
              ))}
            </div>
          )}
      </div>
    </SectionCard>
  );
}

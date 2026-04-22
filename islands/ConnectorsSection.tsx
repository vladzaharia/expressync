/**
 * Grid of `ConnectorCard` islands. Thin wrapper — the only reason it's an
 * island (vs. a server component) is so the per-card event dispatch stays in
 * the same hydration boundary.
 */

import ConnectorCard, { type ConnectorDto } from "./ConnectorCard.tsx";

interface Props {
  chargeBoxId: string;
  connectors: ConnectorDto[];
  isAdmin: boolean;
}

export default function ConnectorsSection(
  { chargeBoxId, connectors, isAdmin }: Props,
) {
  if (connectors.length === 0) {
    return (
      <section
        aria-label="Connectors"
        class="rounded-lg border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground"
      >
        No connectors reported for this charger yet. Trigger a{" "}
        <code class="font-mono text-xs">StatusNotification</code>{" "}
        to see per-connector state.
      </section>
    );
  }

  return (
    <section aria-label="Connectors" class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold">
          Connectors ({connectors.length})
        </h2>
      </div>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {connectors.map((c) => (
          <ConnectorCard
            key={c.connectorId}
            chargeBoxId={chargeBoxId}
            connector={c}
            isAdmin={isAdmin}
          />
        ))}
      </div>
    </section>
  );
}

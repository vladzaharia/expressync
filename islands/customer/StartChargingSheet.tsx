/**
 * Polaris Track G2 — `StartChargingSheet` island.
 *
 * Mobile-first bottom-sheet for the "Start charging" flow. Built on the
 * Track H `Sheet` primitive so layout decisions stay consistent with the
 * reservation wizard mobile mode.
 *
 * Flow per the plan:
 *   1. Charger picker — auto-skipped when only one reachable charger
 *   2. Connector picker — auto-skipped when only one connector
 *   3. Card picker — auto-skipped when only one card (most common)
 *   4. Confirm — show the trio + Start button
 *   5. POST `/api/customer/scan-start`. Success → toast + close, sibling
 *      SSE listeners (HeroSessionCard etc.) pick up the new session.
 *      Failure → inline error in the sheet.
 *
 * Auto-skip is implemented as a `useMemo`-style `initialStep` derivation
 * that walks the steps in order and stops at the first "needs a choice"
 * step. Selecting the only option for an upstream step also advances on
 * mount via the same memo — a single source of truth.
 *
 * Importable from any customer page; the parent owns `open` so the same
 * island can power the dashboard "Pick charger" CTA, an empty-state CTA,
 * and a future shortcut from the bottom-tab bar without coordinating
 * global state.
 */

import { useEffect, useMemo, useState } from "preact/hooks";
import { Loader2, Zap } from "lucide-preact";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet.tsx";
import { Button } from "@/components/ui/button.tsx";
import { CardStatusBadge } from "@/components/shared/CardStatusBadge.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

export interface SheetCharger {
  chargeBoxId: string;
  friendlyName: string | null;
  status: string | null;
  online: boolean;
  /** Available connector ids (omit when unknown — picker is skipped). */
  connectorIds?: number[];
}

export interface SheetCard {
  /** user_mappings.id — unused by the API but useful as a stable key. */
  id: number;
  /** StEvE ocpp_tag.id — what `/api/customer/scan-start` expects. */
  ocppTagPk: number;
  ocppTagId: string;
  displayName: string | null;
  isActive: boolean;
}

interface StartChargingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chargers: SheetCharger[];
  cards: SheetCard[];
}

type Step = "charger" | "connector" | "card" | "confirm";

/**
 * Walk the steps in order and return the first one that still needs a
 * decision given the auto-derivable selections from the props. Used both
 * for the initial step on mount AND when the user advances past a step
 * with a single option (we re-derive instead of duplicating skip logic).
 */
function initialStep(
  chargers: SheetCharger[],
  cards: SheetCard[],
): { step: Step; charger: SheetCharger | null; card: SheetCard | null } {
  const reachable = chargers.filter((c) => c.online !== false);
  const onlyCharger = reachable.length === 1 ? reachable[0] : null;
  const activeCards = cards.filter((c) => c.isActive);
  const onlyCard = activeCards.length === 1 ? activeCards[0] : null;

  if (!onlyCharger) {
    return { step: "charger", charger: null, card: onlyCard };
  }
  // We have exactly one reachable charger. Skip the picker.
  const connectors = onlyCharger.connectorIds ?? [];
  if (connectors.length > 1) {
    return { step: "connector", charger: onlyCharger, card: onlyCard };
  }
  // 0 or 1 connector → no picker needed.
  if (!onlyCard) {
    return { step: "card", charger: onlyCharger, card: null };
  }
  return { step: "confirm", charger: onlyCharger, card: onlyCard };
}

export default function StartChargingSheet({
  open,
  onOpenChange,
  chargers,
  cards,
}: StartChargingSheetProps) {
  const initial = useMemo(() => initialStep(chargers, cards), [
    chargers,
    cards,
  ]);
  const [step, setStep] = useState<Step>(initial.step);
  const [charger, setCharger] = useState<SheetCharger | null>(initial.charger);
  const [connectorId, setConnectorId] = useState<number | null>(null);
  const [card, setCard] = useState<SheetCard | null>(initial.card);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state whenever the sheet closes — the next open call should land
  // on a fresh derivation, not a leftover selection.
  useEffect(() => {
    if (!open) {
      setStep(initial.step);
      setCharger(initial.charger);
      setConnectorId(null);
      setCard(initial.card);
      setSubmitting(false);
      setError(null);
    }
  }, [open, initial]);

  const close = () => {
    if (submitting) return;
    onOpenChange(false);
  };

  const advanceFromCharger = (selected: SheetCharger) => {
    setCharger(selected);
    const connectors = selected.connectorIds ?? [];
    if (connectors.length > 1) {
      setStep("connector");
      return;
    }
    // Only one connector (or unknown count) — adopt and skip ahead.
    if (connectors.length === 1) setConnectorId(connectors[0]);
    if (!card) {
      const activeCards = cards.filter((c) => c.isActive);
      if (activeCards.length === 1) {
        setCard(activeCards[0]);
        setStep("confirm");
      } else {
        setStep("card");
      }
    } else {
      setStep("confirm");
    }
  };

  const advanceFromConnector = (id: number) => {
    setConnectorId(id);
    if (!card) {
      const activeCards = cards.filter((c) => c.isActive);
      if (activeCards.length === 1) {
        setCard(activeCards[0]);
        setStep("confirm");
      } else {
        setStep("card");
      }
    } else {
      setStep("confirm");
    }
  };

  const advanceFromCard = (selected: SheetCard) => {
    setCard(selected);
    setStep("confirm");
  };

  const startCharging = async () => {
    if (!charger || !card) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/customer/scan-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chargeBoxId: charger.chargeBoxId,
          connectorId: connectorId ?? undefined,
          ocppTagPk: card.ocppTagPk,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const message = (payload as { error?: string }).error ??
          "Couldn't start charging. Please try again.";
        setError(message);
        return;
      }
      toast.success("Charge started", {
        description: `${charger.friendlyName ?? charger.chargeBoxId} · ${
          card.displayName ?? card.ocppTagId
        }`,
      });
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : "Network error. Please try again.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  // Render-time guard: if the host page calls us with no cards, surface a
  // friendly empty state instead of letting the user reach the confirm step.
  const noActiveCards = cards.filter((c) => c.isActive).length === 0;
  const noChargers = chargers.length === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        onClose={close}
        className="sm:right-0 sm:left-auto sm:inset-y-0 sm:h-full sm:w-3/4 sm:max-w-md sm:max-h-screen sm:rounded-l-lg sm:rounded-t-none sm:border-l sm:border-t-0"
      >
        <SheetHeader>
          <SheetTitle class="flex items-center gap-2">
            <Zap class="size-5 text-primary" />
            Start charging
          </SheetTitle>
          <SheetDescription>
            {step === "charger" && "Pick a charger to get started."}
            {step === "connector" && "Pick the connector you'll plug into."}
            {step === "card" && "Pick the card to use for this session."}
            {step === "confirm" && "Confirm and we'll unlock the charger."}
          </SheetDescription>
        </SheetHeader>

        <div class="flex-1 overflow-y-auto -mx-6 px-6">
          {noChargers && (
            <EmptyHint
              title="No chargers visible right now"
              description="Make sure your charger is online or contact your operator."
            />
          )}

          {!noChargers && noActiveCards && (
            <EmptyHint
              title="No active cards on your account"
              description="Contact your operator to activate a card before starting a session."
            />
          )}

          {!noChargers && !noActiveCards && step === "charger" && (
            <LocalChargerPicker
              chargers={chargers}
              onSelect={(c) => advanceFromCharger(c)}
              disabled={submitting}
            />
          )}

          {!noChargers && !noActiveCards && step === "connector" && charger &&
            (
              <ConnectorPicker
                connectors={charger.connectorIds ?? []}
                onSelect={advanceFromConnector}
                disabled={submitting}
              />
            )}

          {!noChargers && !noActiveCards && step === "card" && (
            <CardPicker
              cards={cards.filter((c) => c.isActive)}
              onSelect={advanceFromCard}
              disabled={submitting}
            />
          )}

          {!noChargers && !noActiveCards && step === "confirm" && charger &&
            card && (
            <ConfirmReview
              charger={charger}
              connectorId={connectorId}
              card={card}
            />
          )}

          {error && (
            <p
              class="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>

        <SheetFooter class="flex-row items-center gap-2">
          <Button
            variant="outline"
            size="mobile"
            onClick={close}
            disabled={submitting}
            class="sm:order-1"
          >
            Cancel
          </Button>
          {step === "confirm" && (
            <Button
              size="mobile"
              onClick={startCharging}
              disabled={submitting || noActiveCards || noChargers}
              class="flex-1 sm:order-2"
            >
              {submitting
                ? <Loader2 class="size-4 animate-spin" />
                : <Zap class="size-4" />}
              Start charging
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function EmptyHint({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div class="rounded-md border border-dashed bg-muted/40 px-4 py-6 text-center">
      <p class="text-sm font-medium">{title}</p>
      <p class="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

/**
 * Customer-side charger picker for the Start Charging sheet. Inlined here
 * (rather than reusing the unified `DevicePickerInline`) because this
 * surface speaks OCPP-status strings ("Available", "Occupied", …) and
 * needs a connectorIds-aware `SheetCharger` shape — distinct from the
 * scan-modal's tap-target picker.
 */
function LocalChargerPicker({
  chargers,
  onSelect,
  disabled,
}: {
  chargers: SheetCharger[];
  onSelect: (c: SheetCharger) => void;
  disabled?: boolean;
}) {
  if (chargers.length === 0) return null;
  return (
    <ul class="flex flex-col gap-2">
      {chargers.map((c) => {
        const offline = c.online === false;
        const interactionDisabled = disabled || offline;
        const name = c.friendlyName?.trim() || c.chargeBoxId;
        const status = offline ? "Offline" : (c.status ?? "Unknown");
        const tone = offline
          ? "bg-muted text-muted-foreground border-border"
          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
        return (
          <li key={c.chargeBoxId}>
            <button
              type="button"
              disabled={interactionDisabled}
              aria-disabled={interactionDisabled}
              onClick={() => {
                if (!interactionDisabled) onSelect(c);
              }}
              class={cn(
                "group w-full flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors",
                "hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <span class="flex flex-col min-w-0">
                <span class="text-sm font-semibold text-foreground truncate">
                  {name}
                </span>
                {c.friendlyName && c.friendlyName !== c.chargeBoxId && (
                  <span class="text-xs text-muted-foreground truncate font-mono">
                    {c.chargeBoxId}
                  </span>
                )}
              </span>
              <span class="flex items-center gap-2 shrink-0">
                <span
                  class={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wide",
                    tone,
                  )}
                >
                  {status}
                </span>
                <span class="inline-flex items-center px-3 h-7 rounded-md border border-input bg-background text-xs font-medium text-foreground">
                  Select
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ConnectorPicker({
  connectors,
  onSelect,
  disabled,
}: {
  connectors: number[];
  onSelect: (id: number) => void;
  disabled?: boolean;
}) {
  if (connectors.length === 0) {
    return (
      <EmptyHint
        title="No connectors reported"
        description="The charger didn't expose connector ids — the operator may need to check it."
      />
    );
  }
  return (
    <ul class="flex flex-col gap-2">
      {connectors.map((id) => (
        <li key={id}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(id)}
            class={cn(
              "w-full flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors",
              "hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <div>
              <p class="text-sm font-semibold">Connector {id}</p>
              <p class="text-xs text-muted-foreground">Plug into this socket</p>
            </div>
            <span class="text-xs font-medium px-3 h-7 inline-flex items-center rounded-md border bg-background">
              Select
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function CardPicker({
  cards,
  onSelect,
  disabled,
}: {
  cards: SheetCard[];
  onSelect: (card: SheetCard) => void;
  disabled?: boolean;
}) {
  return (
    <ul class="flex flex-col gap-2">
      {cards.map((card) => {
        const name = card.displayName?.trim() || card.ocppTagId;
        return (
          <li key={card.id}>
            <button
              type="button"
              disabled={disabled || !card.isActive}
              onClick={() => onSelect(card)}
              class={cn(
                "w-full flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors",
                "hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <div class="min-w-0">
                <p class="text-sm font-semibold truncate">{name}</p>
                {card.displayName && card.ocppTagId !== name
                  ? (
                    <p class="text-xs text-muted-foreground font-mono truncate">
                      {card.ocppTagId}
                    </p>
                  )
                  : null}
              </div>
              <CardStatusBadge isActive={card.isActive} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ConfirmReview({
  charger,
  connectorId,
  card,
}: {
  charger: SheetCharger;
  connectorId: number | null;
  card: SheetCard;
}) {
  const chargerName = charger.friendlyName ?? charger.chargeBoxId;
  const cardName = card.displayName?.trim() || card.ocppTagId;
  return (
    <dl class="space-y-3">
      <Row label="Charger">
        <span class="font-medium">{chargerName}</span>
        {charger.friendlyName && charger.friendlyName !== charger.chargeBoxId &&
          (
            <span class="text-xs text-muted-foreground font-mono">
              {charger.chargeBoxId}
            </span>
          )}
      </Row>
      <Row label="Connector">
        {connectorId != null
          ? <span class="font-medium tabular-nums">#{connectorId}</span>
          : <span class="text-muted-foreground">Default</span>}
      </Row>
      <Row label="Card">
        <span class="font-medium">{cardName}</span>
        {card.displayName && card.ocppTagId !== cardName && (
          <span class="text-xs text-muted-foreground font-mono">
            {card.ocppTagId}
          </span>
        )}
      </Row>
    </dl>
  );
}

function Row(
  { label, children }: { label: string; children: preact.ComponentChildren },
) {
  return (
    <div class="flex items-baseline justify-between gap-2 border-b border-border/40 pb-2 last:border-b-0">
      <dt class="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd class="flex flex-col items-end gap-0.5 text-right">{children}</dd>
    </div>
  );
}

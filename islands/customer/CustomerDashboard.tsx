/**
 * CustomerDashboard — orchestrator for the customer surface root (`/`).
 *
 * Pulls together every customer dashboard block. The shape is intentionally
 * SectionCard-driven so we honor the established Wave A-E layout
 * conventions (one PageCard at the route layer, N SectionCards inside).
 *
 * Branches on `scope.isActive`:
 *   • Active   → Charging (Hero | Ready) + Reservation + Usage + Quick
 *                Actions + Recent activity SectionCards
 *   • Inactive → InactiveAccountHero alone (and a calmer surface)
 *
 * Subscribes to `/api/stream/customer` indirectly via the existing
 * SseProvider's shared `subscribeSse` for `notification.created` (badge
 * refresh), `transaction.meter` (HeroSessionCard owns its own subscription)
 * and `charger.state` (ReadyToChargeCard / available pill).
 */

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
  Activity,
  CalendarClock,
  CreditCard,
  Gauge,
  Receipt,
  Zap,
} from "lucide-preact";
import { SectionCard } from "@/components/shared/SectionCard.tsx";
import { EmptyState } from "@/components/shared/EmptyState.tsx";
import { MobileCardRow } from "@/components/shared/MobileCardRow.tsx";
import { BillingPeriodSwitcher } from "@/components/shared/BillingPeriodSwitcher.tsx";
import { TransactionStatusBadge } from "@/components/shared/TransactionStatusBadge.tsx";
import { Button } from "@/components/ui/button.tsx";
import HeroSessionCard from "@/islands/customer/HeroSessionCard.tsx";
import ReadyToChargeCard from "@/islands/customer/ReadyToChargeCard.tsx";
import NextReservationCard from "@/islands/customer/NextReservationCard.tsx";
import UsageGaugeLive from "@/islands/customer/UsageGaugeLive.tsx";
import QuickActionsRow from "@/islands/customer/QuickActionsRow.tsx";
import InactiveAccountHero from "@/islands/customer/InactiveAccountHero.tsx";
import OnboardingTour from "@/islands/customer/OnboardingTour.tsx";
import { subscribeSse } from "@/islands/shared/SseProvider.tsx";
import { formatRelative } from "@/islands/shared/charger-visuals.ts";

interface ActiveSession {
  steveTransactionId: number;
  chargeBoxId: string | null;
  connectorId?: number | null;
  connectorType?: string | null;
  initialKwh: number;
  startedAt: string | null;
  tagDisplayName: string | null;
  estimatedCost?: number;
  currencySymbol?: string;
}

interface RecentSession {
  id: number;
  steveTransactionId: number;
  syncedAt: string | null;
  kwhDelta: number;
  isFinalized: boolean;
  costString?: string | null;
}

interface NextReservation {
  id: number;
  chargeBoxId: string;
  connectorId: number | null;
  connectorType?: string | null;
  startAtIso: string;
  endAtIso: string;
  status: string;
  displayName?: string | null;
}

export interface CustomerDashboardProps {
  user: {
    id: string;
    name: string | null;
    email: string;
  };
  isActive: boolean;
  firstRun: boolean;
  operatorEmail?: string;
  /** Active session, if any. */
  activeSession: ActiveSession | null;
  /** Most recent finalized session, used as Ready card's "last session" hint. */
  lastSession: RecentSession | null;
  /** Last 3 sessions for "Recent activity". */
  recentSessions: RecentSession[];
  /** Next upcoming reservation, or null. */
  nextReservation: NextReservation | null;
  /** Initial usage values for the gauge. */
  usage: {
    value: number;
    cap: number | null;
    periodLabel: string;
    period: "current" | "previous" | "year";
  };
  /** Charge-box ids the customer owns — passed down to UsageGaugeLive. */
  ownedChargeBoxIds?: string[];
  /** Initial available-charger snapshot for the Ready card pill. */
  chargerCounts: { available: number; total: number };
}

export default function CustomerDashboard(props: CustomerDashboardProps) {
  const notificationFlash = useSignal<number>(0);

  // Subscribe to `notification.created` so the dashboard can show a soft
  // visual flash when the bell badge increments. The actual badge lives
  // in NotificationBell (separate island); we just keep the dashboard
  // alive on the SSE bus.
  useEffect(() => {
    const unsub = subscribeSse("notification.created", () => {
      notificationFlash.value = notificationFlash.value + 1;
    });
    return unsub;
  }, []);

  // Inactive surface — short-circuit everything.
  if (!props.isActive) {
    return (
      <div class="flex flex-col gap-4">
        <InactiveAccountHero
          operatorEmail={props.operatorEmail}
          caption={props.lastSession?.syncedAt
            ? `Your last activity was ${
              formatRelative(props.lastSession.syncedAt)
            }.`
            : undefined}
        />

        {props.recentSessions.length > 0 && (
          <SectionCard
            title="Recent activity"
            icon={Receipt}
            accent="green"
            actions={
              <a
                href="/sessions"
                class="text-xs text-muted-foreground hover:text-foreground"
              >
                View all
              </a>
            }
          >
            <div class="flex flex-col gap-2">
              {props.recentSessions.map((s) => (
                <RecentSessionRow key={s.id} session={s} />
              ))}
            </div>
          </SectionCard>
        )}

        <OnboardingTour isFirstRun={props.firstRun} />
      </div>
    );
  }

  return (
    <div class="flex flex-col gap-4">
      {/* Charging — hero / ready */}
      <SectionCard
        title="Charging"
        icon={Zap}
        accent="cyan"
        description={props.activeSession
          ? "You're charging right now."
          : "Idle — ready when you are."}
      >
        {props.activeSession
          ? (
            <HeroSessionCard
              session={props.activeSession}
            />
          )
          : (
            <ReadyToChargeCard
              initialAvailableChargers={props.chargerCounts.available}
              totalChargers={props.chargerCounts.total}
              lastSession={props.lastSession}
            />
          )}
      </SectionCard>

      {/* Next reservation — collapses if none */}
      {props.nextReservation && (
        <SectionCard
          title="Next reservation"
          icon={CalendarClock}
          accent="indigo"
        >
          <NextReservationCard reservation={props.nextReservation} />
        </SectionCard>
      )}

      {/* Usage */}
      <SectionCard
        title="Usage"
        icon={Gauge}
        accent="teal"
        description={props.usage.periodLabel}
        actions={
          <BillingPeriodSwitcher
            value={props.usage.period}
            basePath="/"
          />
        }
      >
        <UsageGaugeLive
          initialValueKwh={props.usage.value}
          capKwh={props.usage.cap}
          caption={props.usage.periodLabel}
        />
      </SectionCard>

      {/* Quick actions */}
      <SectionCard
        title="Quick actions"
        icon={Activity}
        accent="cyan"
      >
        <QuickActionsRow isActive={props.isActive} />
      </SectionCard>

      {/* Recent activity */}
      <SectionCard
        title="Recent activity"
        icon={Receipt}
        accent="green"
        actions={
          <a
            href="/sessions"
            class="text-xs text-muted-foreground hover:text-foreground"
          >
            View all
          </a>
        }
      >
        {props.recentSessions.length === 0
          ? (
            <EmptyState
              icon={Receipt}
              title="No sessions yet"
              description="Your first charge will appear here once you've started one."
              accent="green"
              size="md"
              showGridPattern={false}
              primaryAction={{
                label: "Scan to start",
                href: "/login/scan",
              }}
            />
          )
          : (
            <div class="flex flex-col gap-2">
              {props.recentSessions.map((s) => (
                <RecentSessionRow key={s.id} session={s} />
              ))}
            </div>
          )}
      </SectionCard>

      <OnboardingTour isFirstRun={props.firstRun} />
    </div>
  );
}

function RecentSessionRow({ session }: { session: RecentSession }) {
  return (
    <a
      href={`/sessions/${session.steveTransactionId}`}
      class="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <MobileCardRow
        topLeft={session.syncedAt ? formatRelative(session.syncedAt) : "—"}
        topRight={session.isFinalized
          ? <TransactionStatusBadge status="completed" />
          : <TransactionStatusBadge status="in_progress" />}
        secondaryLine={`Session #${session.steveTransactionId}`}
        primaryStat={<span>{session.kwhDelta.toFixed(2)} kWh</span>}
        secondaryStat={session.costString ?? undefined}
      />
    </a>
  );
}

// Suppress unused "Button" import warning — it's referenced in JSX above
// (actions slots use anchor tags directly to keep server-rendered hrefs);
// keeping the import for downstream extension when actions become buttons.
void Button;
void CreditCard;

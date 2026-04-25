/**
 * CustomerDashboard — orchestrator for the customer surface root (`/`).
 *
 * SectionCard-driven layout (one PageCard at the route layer, N
 * SectionCards inside). Active scope branches between Charging (Hero |
 * Ready) + Reservation + Usage + Recent activity. Inactive scope
 * short-circuits to InactiveAccountHero.
 */

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import {
  CalendarClock,
  Gauge,
  Plug,
  Receipt,
  Zap,
} from "lucide-preact";
import { SectionCard } from "@/components/shared/SectionCard.tsx";
import { EmptyState } from "@/components/shared/EmptyState.tsx";
import { BillingPeriodSwitcher } from "@/components/shared/BillingPeriodSwitcher.tsx";
import { Button } from "@/components/ui/button.tsx";
import HeroSessionCard from "@/islands/customer/HeroSessionCard.tsx";
import NextReservationCard from "@/islands/customer/NextReservationCard.tsx";
import PeriodUsageChart, {
  type UsageDayPoint,
} from "@/islands/customer/PeriodUsageChart.tsx";
import { PlanInfoCard, type PlanInfo } from "@/components/customer/PlanInfoCard.tsx";
import {
  RecentActivityList,
  type RecentActivityItem,
} from "@/components/customer/RecentActivityList.tsx";
import InactiveAccountHero from "@/islands/customer/InactiveAccountHero.tsx";
import OnboardingTour from "@/islands/customer/OnboardingTour.tsx";
import { subscribeSse } from "@/islands/shared/SseProvider.tsx";
import { formatRelative } from "@/islands/shared/charger-visuals.ts";
import type { FormFactor } from "@/src/lib/types/steve.ts";
import type { ChargerPickerCharger } from "@/components/customer/ChargerPickerInline.tsx";
import CustomerChargersSection, {
  type CustomerChargerCardDto,
} from "@/islands/customer/CustomerChargersSection.tsx";

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
  startedAt?: string | null;
  endedAt?: string | null;
  kwhDelta: number;
  isFinalized: boolean;
  costString?: string | null;
  durationMinutes?: number | null;
  chargeBoxId?: string | null;
  chargerName?: string | null;
  formFactor?: FormFactor | null;
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
  activeSession: ActiveSession | null;
  lastSession: RecentSession | null;
  recentSessions: RecentSession[];
  nextReservation: NextReservation | null;
  usage: {
    value: number;
    cap: number | null;
    periodLabel: string;
    period: "current" | "previous" | "year";
  };
  /** Daily kWh series for the chart. */
  dailyUsage: UsageDayPoint[];
  /** Plan breakdown for the right-hand card. */
  plan: PlanInfo | null;
  currency: string;
  ownedChargeBoxIds?: string[];
  chargerCounts: { available: number; total: number };
  /** Pre-fetched charger list for the Pick-charger modal. */
  chargerOptions?: ChargerPickerCharger[];
  /** Full charger roster with derived customer-facing status. */
  chargers?: CustomerChargerCardDto[];
}

export default function CustomerDashboard(props: CustomerDashboardProps) {
  const notificationFlash = useSignal<number>(0);

  useEffect(() => {
    const unsub = subscribeSse("notification.created", () => {
      notificationFlash.value = notificationFlash.value + 1;
    });
    return unsub;
  }, []);

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
            accent="blue"
            borderBeam
            actions={
              <a
                href="/sessions"
                class="text-xs text-muted-foreground hover:text-foreground"
              >
                View all
              </a>
            }
          >
            <RecentActivityList
              items={toActivityItems(props.recentSessions)}
            />
          </SectionCard>
        )}

        <OnboardingTour isFirstRun={props.firstRun} />
      </div>
    );
  }

  const chargers = props.chargers ?? [];
  const hasChargers = chargers.length > 0;
  const activeChargerName = props.activeSession
    ? (() => {
      const cbx = props.activeSession.chargeBoxId;
      const match = cbx ? chargers.find((c) => c.chargeBoxId === cbx) : null;
      return match?.friendlyName?.trim() || cbx || "your charger";
    })()
    : null;
  const chargingDescription = props.activeSession
    ? `You're charging on ${activeChargerName} — live`
    : hasChargers
    ? "Idle — ready when you are"
    : "No chargers visible to your account yet";

  return (
    <div class="flex flex-col gap-4">
      {/* Charging — unified hero + roster */}
      <SectionCard
        title="Charging"
        icon={Zap}
        accent="sky"
        description={chargingDescription}
        borderBeam
      >
        <div data-tour="hero" class="flex flex-col gap-4">
          {props.activeSession && (
            <HeroSessionCard session={props.activeSession} />
          )}
          {props.activeSession && hasChargers && (
            <>
              <div class="border-t border-border/50" />
              <p class="text-xs uppercase tracking-wide text-muted-foreground">
                Other chargers
              </p>
            </>
          )}
          {hasChargers && <CustomerChargersSection chargers={chargers} />}
          {!props.activeSession && !hasChargers && (
            <EmptyState
              icon={Plug}
              title="No chargers yet"
              description={props.operatorEmail
                ? `Contact your operator at ${props.operatorEmail}.`
                : "Contact your operator."}
              accent="sky"
              size="md"
              showGridPattern={false}
            />
          )}
        </div>
      </SectionCard>

      {/* Next reservation — collapses if none */}
      {props.nextReservation && (
        <SectionCard
          title="Next reservation"
          icon={CalendarClock}
          accent="blue"
          borderBeam
        >
          <NextReservationCard reservation={props.nextReservation} />
        </SectionCard>
      )}

      {/* Usage — chart + plan side-by-side */}
      <SectionCard
        title="Usage"
        icon={Gauge}
        accent="blue"
        description={props.usage.periodLabel}
        borderBeam
        actions={
          <BillingPeriodSwitcher value={props.usage.period} basePath="/" />
        }
      >
        <div class="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
          <div class="min-w-0 rounded-lg border bg-card p-4 lg:col-span-2">
            <PeriodUsageChart
              points={props.dailyUsage}
              periodLabel={props.usage.periodLabel}
              accent="blue"
            />
          </div>
          {props.plan && (
            <div class="min-w-0 rounded-lg border bg-card p-4 lg:col-span-1">
              <PlanInfoCard plan={props.plan} accent="blue" />
            </div>
          )}
        </div>
      </SectionCard>

      {/* Recent activity */}
      <SectionCard
        title="Recent activity"
        icon={Receipt}
        accent="blue"
        borderBeam
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
              accent="blue"
              size="md"
              showGridPattern={false}
            />
          )
          : (
            <RecentActivityList
              items={toActivityItems(props.recentSessions)}
            />
          )}
      </SectionCard>

      <OnboardingTour isFirstRun={props.firstRun} />
    </div>
  );
}

function toActivityItems(sessions: RecentSession[]): RecentActivityItem[] {
  return sessions.map((s) => ({
    id: s.id,
    steveTransactionId: s.steveTransactionId,
    syncedAt: s.syncedAt,
    startedAt: s.startedAt ?? null,
    endedAt: s.endedAt ?? null,
    kwhDelta: s.kwhDelta,
    isFinalized: s.isFinalized,
    costString: s.costString ?? null,
    chargeBoxId: s.chargeBoxId ?? null,
    chargerName: s.chargerName ?? null,
    formFactor: s.formFactor ?? null,
    durationMinutes: s.durationMinutes ?? null,
  }));
}

// Keep imports live for downstream extension.
void Button;

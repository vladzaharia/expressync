import { define } from "@/utils.ts";
import { db } from "@/src/db/index.ts";
import { lagoWebhookEvents } from "@/src/db/schema.ts";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  ne,
} from "drizzle-orm";
import { SidebarLayout } from "@/components/SidebarLayout.tsx";
import { PageCard } from "@/components/PageCard.tsx";
import WebhookEventsTable, {
  type WebhookEventRow,
} from "@/islands/admin/WebhookEventsTable.tsx";
import WebhookEventFilters, {
  type WebhookFilterState,
} from "@/islands/admin/WebhookEventFilters.tsx";
import CircuitBreakerBanner from "@/islands/admin/CircuitBreakerBanner.tsx";
import { getCircuitBreakerState } from "@/src/services/lago-webhook-handler.service.ts";
import { AlertTriangle } from "lucide-preact";

const PAGE_SIZE = 25;

interface LoaderData {
  items: WebhookEventRow[];
  total: number;
  filters: WebhookFilterState;
  query: string;
  breaker: ReturnType<typeof getCircuitBreakerState>;
  userRole: string;
  forbidden: boolean;
}

export const handler = define.handlers({
  async GET(ctx) {
    const role = ctx.state.user?.role ?? "";
    if (role !== "admin") {
      return {
        data: {
          items: [],
          total: 0,
          filters: emptyFilters(),
          query: "",
          breaker: getCircuitBreakerState(),
          userRole: role,
          forbidden: true,
        } satisfies LoaderData,
      };
    }

    const url = new URL(ctx.req.url);
    const filters: WebhookFilterState = {
      type: url.searchParams.get("type") ?? "",
      status: url.searchParams.get("status") ?? "",
      customer: url.searchParams.get("customer") ?? "",
      subscription: url.searchParams.get("subscription") ?? "",
      start: url.searchParams.get("start") ?? "",
      end: url.searchParams.get("end") ?? "",
      notificationFired: url.searchParams.get("notification_fired") === "1" ||
          url.searchParams.get("notification_fired") === "true"
        ? "true"
        : url.searchParams.get("notification_fired") === "0" ||
            url.searchParams.get("notification_fired") === "false"
        ? "false"
        : "any",
    };

    const conditions = [];
    if (filters.type) {
      conditions.push(eq(lagoWebhookEvents.webhookType, filters.type));
    }
    if (filters.customer) {
      conditions.push(
        ilike(lagoWebhookEvents.externalCustomerId, `%${filters.customer}%`),
      );
    }
    if (filters.subscription) {
      conditions.push(
        ilike(
          lagoWebhookEvents.externalSubscriptionId,
          `%${filters.subscription}%`,
        ),
      );
    }
    if (filters.start) {
      const startDate = new Date(filters.start);
      if (!isNaN(startDate.getTime())) {
        conditions.push(gte(lagoWebhookEvents.receivedAt, startDate));
      }
    }
    if (filters.end) {
      const endDate = new Date(filters.end);
      if (!isNaN(endDate.getTime())) {
        endDate.setHours(23, 59, 59, 999);
        conditions.push(lte(lagoWebhookEvents.receivedAt, endDate));
      }
    }
    if (filters.notificationFired === "true") {
      conditions.push(eq(lagoWebhookEvents.notificationFired, true));
    } else if (filters.notificationFired === "false") {
      conditions.push(eq(lagoWebhookEvents.notificationFired, false));
    }
    if (filters.status === "pending") {
      conditions.push(isNull(lagoWebhookEvents.processedAt));
    } else if (filters.status === "processed") {
      conditions.push(isNotNull(lagoWebhookEvents.processedAt));
      conditions.push(isNull(lagoWebhookEvents.processingError));
    } else if (filters.status === "failed") {
      conditions.push(isNotNull(lagoWebhookEvents.processedAt));
      conditions.push(isNotNull(lagoWebhookEvents.processingError));
      conditions.push(
        ne(lagoWebhookEvents.processingError, "circuit_breaker_open"),
      );
    } else if (filters.status === "skipped") {
      conditions.push(
        eq(lagoWebhookEvents.processingError, "circuit_breaker_open"),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await db
      .select({ value: count() })
      .from(lagoWebhookEvents)
      .where(whereClause);

    const rows = await db
      .select({
        id: lagoWebhookEvents.id,
        webhookType: lagoWebhookEvents.webhookType,
        objectType: lagoWebhookEvents.objectType,
        lagoObjectId: lagoWebhookEvents.lagoObjectId,
        externalCustomerId: lagoWebhookEvents.externalCustomerId,
        externalSubscriptionId: lagoWebhookEvents.externalSubscriptionId,
        receivedAt: lagoWebhookEvents.receivedAt,
        processedAt: lagoWebhookEvents.processedAt,
        processingError: lagoWebhookEvents.processingError,
        notificationFired: lagoWebhookEvents.notificationFired,
        replayedFromId: lagoWebhookEvents.replayedFromId,
        replayedAt: lagoWebhookEvents.replayedAt,
        replayedByUserId: lagoWebhookEvents.replayedByUserId,
      })
      .from(lagoWebhookEvents)
      .where(whereClause)
      .orderBy(desc(lagoWebhookEvents.receivedAt))
      .limit(PAGE_SIZE);

    const items: WebhookEventRow[] = rows.map((r) => ({
      id: r.id,
      webhookType: r.webhookType,
      objectType: r.objectType,
      lagoObjectId: r.lagoObjectId,
      externalCustomerId: r.externalCustomerId,
      externalSubscriptionId: r.externalSubscriptionId,
      receivedAt: r.receivedAt.toISOString(),
      processedAt: r.processedAt ? r.processedAt.toISOString() : null,
      processingError: r.processingError,
      notificationFired: r.notificationFired,
      replayedFromId: r.replayedFromId,
      replayedAt: r.replayedAt ? r.replayedAt.toISOString() : null,
      replayedByUserId: r.replayedByUserId,
    }));

    // Serialize filters back to a canonical query string for the island.
    const qs = new URLSearchParams();
    if (filters.type) qs.set("type", filters.type);
    if (filters.status) qs.set("status", filters.status);
    if (filters.customer) qs.set("customer", filters.customer);
    if (filters.subscription) qs.set("subscription", filters.subscription);
    if (filters.start) qs.set("start", filters.start);
    if (filters.end) qs.set("end", filters.end);
    if (filters.notificationFired === "true") {
      qs.set("notification_fired", "1");
    } else if (filters.notificationFired === "false") {
      qs.set("notification_fired", "0");
    }

    return {
      data: {
        items,
        total: totalRow.value,
        filters,
        query: qs.toString(),
        breaker: getCircuitBreakerState(),
        userRole: role,
        forbidden: false,
      } satisfies LoaderData,
    };
  },
});

function emptyFilters(): WebhookFilterState {
  return {
    type: "",
    status: "",
    customer: "",
    subscription: "",
    start: "",
    end: "",
    notificationFired: "any",
  };
}

export default define.page<typeof handler>(
  function WebhookEventsAdminPage({ data, url, state }) {
    if (data.forbidden) {
      return (
        <SidebarLayout
          currentPath={url.pathname}
          user={state.user}
          accentColor="slate"
        >
          <PageCard
            title="Webhook audit"
            description="Admin access required"
            colorScheme="slate"
          >
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <AlertTriangle
                className="size-8 text-amber-500"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">
                This audit surface is only visible to admin users.
              </p>
            </div>
          </PageCard>
        </SidebarLayout>
      );
    }

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="slate"
      >
        <CircuitBreakerBanner
          initial={data.breaker}
          currentUserRole={data.userRole}
        />
        <div className="space-y-4">
          <PageCard
            title="Lago webhook audit"
            description={`${data.total} event${
              data.total === 1 ? "" : "s"
            } recorded`}
            colorScheme="slate"
          >
            <WebhookEventFilters initial={data.filters} />
          </PageCard>

          <PageCard
            title="Events"
            description="Click a row to expand details · check rows to bulk replay"
            colorScheme="slate"
            animationDelay={0.04}
          >
            <WebhookEventsTable
              initialItems={data.items}
              initialTotal={data.total}
              initialQuery={data.query}
              pageSize={PAGE_SIZE}
              currentUserRole={data.userRole}
            />
          </PageCard>
        </div>
      </SidebarLayout>
    );
  },
);

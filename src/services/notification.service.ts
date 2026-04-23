/**
 * Notification Service (Phase P1)
 *
 * CRUD + read helpers for the `notifications` table. Replaces the log-only
 * `notify()` stub in `lago-webhook-handler.service.ts` with real row inserts
 * so the header bell + archive page have data to display.
 *
 * MVP broadcast model: `adminUserId = null` means "visible to every admin".
 * `markRead(id, userId)` stamps `read_at`; `dismiss(id, userId)` stamps
 * `dismissed_at`. Dismissal hides the row from the archive filter
 * "unread + not dismissed" but keeps it for audit purposes.
 *
 * Source URL derivation lives here so every caller (bell, archive table,
 * mark-read redirects) produces identical links. Adding new source types is a
 * one-liner in `resolveSourceUrl`.
 */

import { and, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import {
  type Notification,
  notifications,
  type NotificationSeverityValue,
  users,
} from "../db/schema.ts";
import { config } from "../lib/config.ts";
import { logger } from "../lib/utils/logger.ts";
import { eventBus } from "./event-bus.service.ts";
import { sendReservationCancelled, sendSessionSummary } from "../lib/email.ts";
import type { SessionSummaryData } from "../lib/email/session-summary.tsx";
import type { ReservationData } from "../lib/email/reservation-cancelled.tsx";

const log = logger.child("NotificationService");

/**
 * Polaris Track H — notification audience values. Mirrors the CHECK
 * constraint on `notifications.audience` (migration 0021).
 *
 * - `admin`     — the existing admin alert feed (default for backwards compat)
 * - `customer`  — single customer feed; `userId` MUST be set
 * - `all`       — broadcast across both surfaces (rare; cross-surface system msg)
 */
export type NotificationAudience = "admin" | "customer" | "all";

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export type NotificationSourceType =
  | "invoice"
  | "alert"
  | "subscription"
  | "wallet_transaction"
  | "webhook_event"
  | "system"
  | "mapping"
  | "charger"
  | "reservation";

export interface CreateNotificationInput {
  kind: string;
  severity: NotificationSeverityValue;
  title: string;
  body: string;
  /** Identifier of the originating entity (used for deep-link chips). */
  sourceType?: NotificationSourceType | null;
  /** ID of the originating entity (string form — invoices/alerts use lago_id,
   * webhook_event uses the lago_webhook_events row id as string). */
  sourceId?: string | null;
  /** Free-form JSON context (never a source of truth). */
  context?: Record<string, unknown> | null;
  /** If set, target this admin only; null = broadcast to all admins. */
  adminUserId?: string | null;
  /**
   * Polaris Track H — routing axis. Defaults to `admin` for backwards
   * compatibility with existing webhook/sync callers. Customer-facing
   * notifications MUST pass `audience: "customer"` AND `userId`.
   */
  audience?: NotificationAudience;
  /**
   * Polaris Track H — target customer's user_id. Required when
   * `audience === "customer"`; otherwise ignored. Stored in the
   * `admin_user_id` column (which is misleadingly named — see schema
   * comment) so a single FK and index serve both audiences.
   */
  userId?: string | null;
  /**
   * Polaris Track H — pre-built email payload for this notification. Used
   * by the post-create email-fire hook to send `session.complete` and
   * `reservation.cancelled` customer emails. Other kinds leave this
   * undefined; the dispatch map below decides whether to honour it.
   */
  emailPayload?:
    | { kind: "session.complete"; session: SessionSummaryData }
    | {
      kind: "reservation.cancelled";
      reservation: ReservationData;
      reason?: string;
    };
}

export interface NotificationDTO {
  id: number;
  kind: string;
  severity: NotificationSeverityValue;
  title: string;
  body: string;
  sourceType: NotificationSourceType | null;
  sourceId: string | null;
  sourceUrl: string | null;
  context: Record<string, unknown> | null;
  adminUserId: string | null;
  readAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}

export interface ListArchiveParams {
  limit?: number;
  offset?: number;
  severity?: NotificationSeverityValue | null;
  kind?: string | null;
  /** Filter by read state: true = read only, false = unread only, undefined = any. */
  readState?: boolean;
  /** Filter to a specific source type. */
  sourceType?: NotificationSourceType | null;
}

export interface ListArchiveResult {
  items: NotificationDTO[];
  total: number;
}

// ----------------------------------------------------------------------------
// URL derivation
// ----------------------------------------------------------------------------

/**
 * Resolve the click-through URL for a notification row. Returns null when the
 * source type is `system` or unknown — caller should render the chip disabled.
 *
 * Cross-domain references (Lago dashboard) are emitted as absolute URLs via
 * `config.LAGO_DASHBOARD_URL`. When that env var is unset we fall back to null
 * rather than emit a broken relative link.
 */
export function resolveSourceUrl(
  sourceType: string | null,
  sourceId: string | null,
): string | null {
  if (!sourceType || !sourceId) return null;
  const lagoBase = config.LAGO_DASHBOARD_URL;

  switch (sourceType) {
    case "invoice":
      return `/invoices/${sourceId}`;
    case "webhook_event":
      return `/admin/webhook-events/${sourceId}`;
    case "subscription":
      return `/links?subscriptionId=${encodeURIComponent(sourceId)}`;
    case "mapping":
      return `/links/${sourceId}`;
    case "charger":
      return `/chargers/${encodeURIComponent(sourceId)}`;
    case "reservation":
      return `/reservations/${sourceId}`;
    case "alert":
      return lagoBase ? `${lagoBase}/alerts/${sourceId}` : null;
    case "wallet_transaction":
      return lagoBase ? `${lagoBase}/wallet-transactions/${sourceId}` : null;
    case "system":
    default:
      return null;
  }
}

// ----------------------------------------------------------------------------
// Mapping
// ----------------------------------------------------------------------------

function toDTO(row: Notification): NotificationDTO {
  const sourceType = (row.sourceType ?? null) as NotificationSourceType | null;
  return {
    id: row.id,
    kind: row.kind,
    severity: row.severity as NotificationSeverityValue,
    title: row.title,
    body: row.body,
    sourceType,
    sourceId: row.sourceId ?? null,
    sourceUrl: resolveSourceUrl(row.sourceType, row.sourceId),
    context: (row.context ?? null) as Record<string, unknown> | null,
    adminUserId: row.adminUserId ?? null,
    readAt: row.readAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

// ----------------------------------------------------------------------------
// CRUD
// ----------------------------------------------------------------------------

/**
 * Polaris Track H — kinds that fire a customer email after the row is
 * inserted. Confined to the silent-lifecycle directive's two cost-
 * transparency emails (session summary + reservation cancellation).
 *
 * Lifecycle events (`subscription.terminated`, `subscription.started`,
 * `account.auto_create`) are intentionally excluded — see the
 * silent-lifecycle directive in the plan.
 */
const EMAIL_FIRING_KINDS = new Set<string>([
  "session.complete",
  "reservation.cancelled",
]);

/**
 * Resolve the target customer's email address. Caller is responsible for
 * supplying a `userId` that points at a `users.role = 'customer'` row;
 * this helper just looks the email up and returns null on a miss so the
 * post-create email dispatch can no-op without throwing.
 */
async function resolveCustomerEmail(userId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.email ?? null;
  } catch (err) {
    log.warn("resolveCustomerEmail failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Polaris Track H — fire the customer email tied to this notification.
 *
 * Wrapped in try/catch so a Worker outage NEVER blocks notification
 * insertion. The notification row is the source of truth for the in-app
 * bell; the email is best-effort.
 */
async function fireCustomerEmail(
  input: CreateNotificationInput,
): Promise<void> {
  if (!input.emailPayload) return;
  if (input.audience !== "customer") return;
  if (!input.userId) return;
  if (!EMAIL_FIRING_KINDS.has(input.kind)) return;

  const email = await resolveCustomerEmail(input.userId);
  if (!email) {
    log.warn("Customer email lookup failed; skipping email dispatch", {
      kind: input.kind,
      userId: input.userId,
    });
    return;
  }

  // Both helpers NEVER throw — they return a SendEmailResult capturing
  // worker outages / misconfiguration / no-email recipients. Notification
  // row is persisted regardless; the bell will surface it. The result is
  // logged at warn-level so ops can spot a worker outage.
  let result;
  if (input.emailPayload.kind === "session.complete") {
    result = await sendSessionSummary(email, input.emailPayload.session);
  } else if (input.emailPayload.kind === "reservation.cancelled") {
    result = await sendReservationCancelled(
      email,
      input.emailPayload.reservation,
      input.emailPayload.reason,
    );
  }
  if (result && !result.ok) {
    log.warn("Customer email send degraded (non-fatal)", {
      kind: input.kind,
      userId: input.userId,
      status: result.status,
      reason: result.reason,
    });
  }
}

/**
 * Insert a notification row. Returns the created DTO.
 *
 * Never throws into caller — logs and returns null on insert failure so the
 * webhook/sync pipelines that call this are not destabilized by notification
 * persistence problems.
 *
 * Polaris Track H: when `audience='customer'` AND `kind` is in
 * `EMAIL_FIRING_KINDS` AND `emailPayload` is supplied, also fires the
 * matching customer email via the Cloudflare Email Worker. Email failures
 * are logged and swallowed so they don't block the notification insert.
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<NotificationDTO | null> {
  // The schema column is named `admin_user_id` for backwards compatibility
  // (see comment on `notifications.adminUserId`). For customer audience the
  // caller supplies `userId`; we route either through the same column.
  const audience: NotificationAudience = input.audience ?? "admin";
  const targetUserId = audience === "customer"
    ? (input.userId ?? null)
    : (input.adminUserId ?? null);

  try {
    const [inserted] = await db
      .insert(notifications)
      .values({
        kind: input.kind,
        severity: input.severity,
        title: input.title,
        body: input.body,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        context: (input.context ?? null) as Record<string, unknown> | null,
        adminUserId: targetUserId,
        audience,
      })
      .returning();

    const dto = toDTO(inserted);
    // Phase P7: fan-out to SSE subscribers. Non-fatal if there are no
    // subscribers; the buffered replay keeps a 60s grace window.
    try {
      eventBus.publish({
        type: "notification.created",
        payload: {
          id: dto.id,
          kind: dto.kind,
          severity: dto.severity,
          title: dto.title,
          body: dto.body,
          sourceType: dto.sourceType,
          sourceId: dto.sourceId,
          sourceUrl: dto.sourceUrl,
          adminUserId: dto.adminUserId,
          createdAt: dto.createdAt,
        },
      });
    } catch (pubErr) {
      log.warn("eventBus.publish(notification.created) failed", {
        error: pubErr instanceof Error ? pubErr.message : String(pubErr),
      });
    }

    // Polaris Track H — fire the customer email AFTER the notification row
    // is persisted. Awaited so a single createNotification call can be
    // sequenced behind a Promise.all by the caller, but failures are
    // swallowed inside fireCustomerEmail.
    await fireCustomerEmail(input);

    return dto;
  } catch (err) {
    log.error("Failed to insert notification", {
      kind: input.kind,
      severity: input.severity,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Mark a single notification as read, scoped to the supplied user OR broadcast
 * rows (adminUserId IS NULL). Returns true when a row was updated.
 */
export async function markRead(id: number, userId: string): Promise<boolean> {
  const res = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        isNull(notifications.readAt),
        or(
          eq(notifications.adminUserId, userId),
          isNull(notifications.adminUserId),
        ),
      ),
    )
    .returning({ id: notifications.id });
  if (res.length > 0) {
    eventBus.publish({
      type: "notification.read",
      payload: { id, adminUserId: userId, count: 1 },
    });
  }
  return res.length > 0;
}

/**
 * Mark every unread notification visible to the supplied user as read.
 * Returns the number of rows affected.
 */
export async function markAllRead(userId: string): Promise<number> {
  const res = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        isNull(notifications.readAt),
        or(
          eq(notifications.adminUserId, userId),
          isNull(notifications.adminUserId),
        ),
      ),
    )
    .returning({ id: notifications.id });
  if (res.length > 0) {
    eventBus.publish({
      type: "notification.read",
      payload: { id: null, adminUserId: userId, count: res.length },
    });
  }
  return res.length;
}

/** Mark a single notification as dismissed. */
export async function dismiss(id: number, userId: string): Promise<boolean> {
  const res = await db
    .update(notifications)
    .set({ dismissedAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        or(
          eq(notifications.adminUserId, userId),
          isNull(notifications.adminUserId),
        ),
      ),
    )
    .returning({ id: notifications.id });
  return res.length > 0;
}

/**
 * Count unread, non-dismissed notifications for an admin user (including
 * broadcast rows). Filters out customer-targeted notifications via the
 * `audience` column so the admin bell never accidentally shows a row meant
 * for a customer surface.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(
        isNull(notifications.readAt),
        isNull(notifications.dismissedAt),
        or(
          eq(notifications.adminUserId, userId),
          isNull(notifications.adminUserId),
        ),
        // Admin feed: only show admin or broadcast rows.
        or(
          eq(notifications.audience, "admin"),
          eq(notifications.audience, "all"),
        ),
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * Fetch the newest unread notifications for the admin bell dropdown.
 */
export async function getUnread(
  userId: string,
  limit = 5,
): Promise<NotificationDTO[]> {
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        isNull(notifications.readAt),
        isNull(notifications.dismissedAt),
        or(
          eq(notifications.adminUserId, userId),
          isNull(notifications.adminUserId),
        ),
        or(
          eq(notifications.audience, "admin"),
          eq(notifications.audience, "all"),
        ),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows.map(toDTO);
}

// ----------------------------------------------------------------------------
// Customer-scoped feed (Polaris Track F)
// ----------------------------------------------------------------------------

/**
 * Count unread, non-dismissed notifications for a customer user.
 *
 * The notifications schema stores the target user_id in `admin_user_id`
 * (the column was repurposed when audience routing was added — see the
 * column docstring on `notifications.adminUserId`). For customers we filter
 * `audience IN ('customer','all')` so admin-only rows never bleed in even
 * if a row is mis-targeted.
 */
export async function getCustomerUnreadCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(
        isNull(notifications.readAt),
        isNull(notifications.dismissedAt),
        or(
          eq(notifications.adminUserId, userId),
          // Broadcast rows ('all') with no specific target.
          and(
            eq(notifications.audience, "all"),
            isNull(notifications.adminUserId),
          ),
        ),
        or(
          eq(notifications.audience, "customer"),
          eq(notifications.audience, "all"),
        ),
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * Fetch the newest unread notifications for the customer bell dropdown.
 */
export async function getCustomerUnread(
  userId: string,
  limit = 5,
): Promise<NotificationDTO[]> {
  const rows = await db
    .select()
    .from(notifications)
    .where(
      and(
        isNull(notifications.readAt),
        isNull(notifications.dismissedAt),
        or(
          eq(notifications.adminUserId, userId),
          and(
            eq(notifications.audience, "all"),
            isNull(notifications.adminUserId),
          ),
        ),
        or(
          eq(notifications.audience, "customer"),
          eq(notifications.audience, "all"),
        ),
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows.map(toDTO);
}

/**
 * Paginated archive listing for a customer user. Same filter logic as the
 * admin variant but adds the customer audience gate.
 */
export async function listCustomerArchive(
  userId: string,
  params: ListArchiveParams = {},
): Promise<ListArchiveResult> {
  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);

  const conditions = [
    or(
      eq(notifications.adminUserId, userId),
      and(
        eq(notifications.audience, "all"),
        isNull(notifications.adminUserId),
      ),
    )!,
    or(
      eq(notifications.audience, "customer"),
      eq(notifications.audience, "all"),
    )!,
  ];

  if (params.severity) {
    conditions.push(eq(notifications.severity, params.severity));
  }
  if (params.kind) {
    conditions.push(eq(notifications.kind, params.kind));
  }
  if (params.sourceType) {
    conditions.push(eq(notifications.sourceType, params.sourceType));
  }
  if (params.readState === true) {
    conditions.push(sql`${notifications.readAt} IS NOT NULL`);
  } else if (params.readState === false) {
    conditions.push(isNull(notifications.readAt));
  }

  const whereClause = and(...conditions);

  const rowsPromise = db
    .select()
    .from(notifications)
    .where(whereClause)
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);

  const totalPromise = db
    .select({ n: count() })
    .from(notifications)
    .where(whereClause);

  const [rows, totalRows] = await Promise.all([rowsPromise, totalPromise]);

  return {
    items: rows.map(toDTO),
    total: Number(totalRows[0]?.n ?? 0),
  };
}

/**
 * Paginated archive listing with filters. Used by the archive page.
 */
export async function listArchive(
  params: ListArchiveParams = {},
): Promise<ListArchiveResult> {
  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);

  const conditions = [];
  if (params.severity) {
    conditions.push(eq(notifications.severity, params.severity));
  }
  if (params.kind) {
    conditions.push(eq(notifications.kind, params.kind));
  }
  if (params.sourceType) {
    conditions.push(eq(notifications.sourceType, params.sourceType));
  }
  if (params.readState === true) {
    conditions.push(sql`${notifications.readAt} IS NOT NULL`);
  } else if (params.readState === false) {
    conditions.push(isNull(notifications.readAt));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rowsPromise = db
    .select()
    .from(notifications)
    .where(whereClause)
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);

  const totalPromise = db
    .select({ n: count() })
    .from(notifications)
    .where(whereClause);

  const [rows, totalRows] = await Promise.all([rowsPromise, totalPromise]);

  return {
    items: rows.map(toDTO),
    total: Number(totalRows[0]?.n ?? 0),
  };
}

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
} from "../db/schema.ts";
import { config } from "../lib/config.ts";
import { logger } from "../lib/utils/logger.ts";
import { eventBus } from "./event-bus.service.ts";

const log = logger.child("NotificationService");

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
 * Insert a notification row. Returns the created DTO.
 *
 * Never throws into caller — logs and returns null on insert failure so the
 * webhook/sync pipelines that call this are not destabilized by notification
 * persistence problems.
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<NotificationDTO | null> {
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
        adminUserId: input.adminUserId ?? null,
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
 * Count unread, non-dismissed notifications for the user (including broadcast).
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
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * Fetch the newest unread notifications for the bell dropdown.
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
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows.map(toDTO);
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

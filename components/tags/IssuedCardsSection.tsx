/**
 * Issued cards section — full-width table on `/tags/[tagPk]`.
 *
 * For meta-tags: hides the "Issue Card" CTA and renders an explanatory line.
 * For non-meta without a mapping: hides the CTA (server rejects issuance
 * without a user_mapping) and invites the user to link the tag first.
 * For unlinked-but-mapped: allows "skipped_sync" but disables the Lago modes
 * (handled by the dialog island itself).
 *
 * The `issuedCardsMissing` flag is set when the DB migration for `issued_cards`
 * has not been applied. We render an informative empty state rather than
 * suppress the entire section.
 */

import {
  AlertTriangle,
  CreditCard,
  ExternalLink,
  Info,
  Layers,
} from "lucide-preact";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import MappingIssueCardAction from "@/islands/MappingIssueCardAction.tsx";
import { formatRelative } from "@/islands/shared/charger-visuals.ts";
import {
  IconEVCard,
  IconKeytag,
  IconSticker,
} from "@/components/brand/tags/index.ts";
import type { TagIconProps } from "@/components/brand/tags/types.ts";

export interface IssuedCardRow {
  id: number;
  cardType: string;
  billingMode: "charged" | "no_cost" | "skipped_sync" | string;
  issuedAt: string;
  issuedByEmail: string | null;
  note: string | null;
  lagoInvoiceId: string | null;
  /** Pre-built invoice dashboard URL, or null if not syncable. */
  lagoInvoiceUrl: string | null;
  syncError: string | null;
}

interface Props {
  tagPk: number;
  /** null when the tag has no user_mapping yet. */
  mappingId: number | null;
  /** Pre-resolved display label for the issuance dialog title. */
  mappingLabel: string | null;
  /** Controls whether the Charged/NoCost modes are enabled in the dialog. */
  hasLagoCustomer: boolean;
  isMeta: boolean;
  rows: IssuedCardRow[];
  /** Set when the `issued_cards` DB table does not yet exist (migration 0011). */
  issuedCardsMissing: boolean;
}

const CARD_TYPE_META: Record<
  string,
  {
    label: string;
    Icon: preact.ComponentType<TagIconProps> | null;
    color: string;
  }
> = {
  ev_card: { label: "EV Card", Icon: IconEVCard, color: "text-blue-500" },
  keytag: { label: "Keytag", Icon: IconKeytag, color: "text-emerald-500" },
  sticker: { label: "Sticker", Icon: IconSticker, color: "text-rose-500" },
};

function billingModeBadge(mode: string): {
  label: string;
  className: string;
} {
  switch (mode) {
    case "charged":
      return {
        label: "Charged",
        className: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
      };
    case "no_cost":
      return {
        label: "No cost",
        className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      };
    case "skipped_sync":
      return {
        label: "Skipped sync",
        className: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
      };
    default:
      return {
        label: mode,
        className: "bg-muted text-muted-foreground",
      };
  }
}

function fmtAbsolute(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function IssuedCardsSection(
  {
    tagPk: _tagPk,
    mappingId,
    mappingLabel,
    hasLagoCustomer,
    isMeta,
    rows,
    issuedCardsMissing,
  }: Props,
) {
  const showIssueButton = !isMeta && mappingId !== null && !issuedCardsMissing;

  return (
    <Card id="cards">
      <CardHeader class="flex flex-row items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <CreditCard
            class="h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <CardTitle class="text-base">Issued cards</CardTitle>
          {rows.length > 0
            ? (
              <Badge variant="outline" class="font-normal">
                {rows.length}
              </Badge>
            )
            : null}
        </div>
        {showIssueButton
          ? (
            <MappingIssueCardAction
              userMappingId={mappingId}
              mappingLabel={mappingLabel}
              hasLagoCustomer={hasLagoCustomer}
              isMeta={false}
            />
          )
          : isMeta
          ? (
            <div
              class="flex items-center gap-1.5 rounded-md border border-dashed border-input bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground"
              title="Meta-tags are hierarchy rollups, not physical cards."
            >
              <Layers class="h-3.5 w-3.5" aria-hidden="true" />
              <span>Meta-tag — issue cards on children</span>
            </div>
          )
          : null}
      </CardHeader>
      <CardContent>
        {issuedCardsMissing
          ? (
            <div class="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400">
              <Info class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p class="font-medium">Card history unavailable</p>
                <p class="text-xs">
                  The `issued_cards` table has not been migrated yet. Apply{" "}
                  <code class="font-mono">
                    drizzle/0011_add_billing_profile.sql
                  </code>{" "}
                  to enable card issuance.
                </p>
              </div>
            </div>
          )
          : rows.length === 0
          ? (
            <div class="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center">
              <CreditCard
                class="h-5 w-5 text-muted-foreground"
                aria-hidden="true"
              />
              <p class="text-sm font-medium">No cards issued yet</p>
              <p class="text-xs text-muted-foreground">
                {isMeta
                  ? "Meta-tags do not accept direct card issuance."
                  : mappingId === null
                  ? "Link this tag to a Lago customer before issuing a card."
                  : "Use the Issue Card button above to record the first one."}
              </p>
            </div>
          )
          : (
            <div
              role="region"
              aria-label="Issued cards"
              tabindex={0}
              class="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <table class="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr class="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th class="px-3 py-2 font-medium">Issued</th>
                    <th class="px-3 py-2 font-medium">Form factor</th>
                    <th class="px-3 py-2 font-medium">Billing mode</th>
                    <th class="px-3 py-2 font-medium">Invoice</th>
                    <th class="hidden px-3 py-2 font-medium md:table-cell">
                      Issued by
                    </th>
                    <th class="hidden px-3 py-2 font-medium md:table-cell">
                      Note
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const meta = CARD_TYPE_META[row.cardType];
                    const Icon = meta?.Icon ?? null;
                    const badge = billingModeBadge(row.billingMode);
                    return (
                      <tr
                        key={row.id}
                        class={cn(
                          "border-b last:border-b-0",
                          row.syncError && "bg-destructive/5",
                        )}
                      >
                        <td class="px-3 py-2 align-top">
                          <div
                            class="whitespace-nowrap"
                            title={fmtAbsolute(row.issuedAt)}
                          >
                            {fmtAbsolute(row.issuedAt)}
                          </div>
                          <div class="text-xs text-muted-foreground">
                            {formatRelative(row.issuedAt)}
                          </div>
                        </td>
                        <td class="px-3 py-2 align-top">
                          <div class="flex items-center gap-2">
                            {Icon
                              ? (
                                <Icon
                                  size="sm"
                                  class={cn("shrink-0", meta?.color)}
                                />
                              )
                              : null}
                            <span>{meta?.label ?? row.cardType}</span>
                          </div>
                        </td>
                        <td class="px-3 py-2 align-top">
                          <div class="flex items-center gap-2">
                            <span
                              class={cn(
                                "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
                                badge.className,
                              )}
                            >
                              {badge.label}
                            </span>
                            {row.syncError
                              ? (
                                <span
                                  class="inline-flex items-center gap-1 text-xs text-destructive"
                                  title={row.syncError}
                                >
                                  <AlertTriangle
                                    class="h-3 w-3"
                                    aria-hidden="true"
                                  />
                                  Sync failed
                                </span>
                              )
                              : null}
                          </div>
                        </td>
                        <td class="px-3 py-2 align-top">
                          {row.lagoInvoiceUrl
                            ? (
                              <a
                                href={row.lagoInvoiceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Open invoice in Lago (opens in new tab)"
                                class="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                              >
                                <ExternalLink
                                  class="h-3 w-3"
                                  aria-hidden="true"
                                />
                                <span class="truncate">View</span>
                              </a>
                            )
                            : row.lagoInvoiceId
                            ? (
                              <code
                                class="truncate font-mono text-xs text-muted-foreground"
                                title={row.lagoInvoiceId}
                              >
                                {row.lagoInvoiceId.slice(0, 8)}…
                              </code>
                            )
                            : (
                              <span class="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                        </td>
                        <td class="hidden px-3 py-2 align-top md:table-cell">
                          <span class="text-xs">
                            {row.issuedByEmail ?? (
                              <span class="text-muted-foreground">—</span>
                            )}
                          </span>
                        </td>
                        <td class="hidden px-3 py-2 align-top md:table-cell">
                          <span
                            class="block max-w-[240px] truncate text-xs text-muted-foreground"
                            title={row.note ?? undefined}
                          >
                            {row.note ?? "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </CardContent>
    </Card>
  );
}

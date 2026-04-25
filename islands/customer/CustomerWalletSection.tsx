/**
 * CustomerWalletSection — read-only wallet summary + last-5 transactions.
 *
 * Rendered inside a `SectionCard "Wallet"` on the Billing page, only when the
 * loader found at least one Lago wallet for the customer. Pure presentation —
 * it's an island purely because we may later add a "Top up" CTA that opens
 * the Lago hosted portal or a confirm modal.
 */

import {
  ArrowDownCircle,
  ArrowUpCircle,
  Clock,
  Wallet as WalletIcon,
} from "lucide-preact";
import { MetricTile } from "@/components/shared/MetricTile.tsx";
import { MoneyBadge } from "@/components/billing/MoneyBadge.tsx";
import type { AccentColor } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";

export interface WalletTransactionDto {
  id: string;
  dateIso: string;
  cents: number;
  type: "inbound" | "outbound";
  status: string;
}

export interface WalletData {
  balanceCents: number;
  consumedCents: number;
  lastTopUpIso: string | null;
  currency: string;
  transactions: WalletTransactionDto[];
}

interface Props {
  wallet: WalletData;
  accent?: AccentColor;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function CustomerWalletSection(
  { wallet, accent = "blue" }: Props,
) {
  return (
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricTile
          icon={WalletIcon}
          label="Balance"
          value={
            <MoneyBadge
              cents={wallet.balanceCents}
              currency={wallet.currency}
            />
          }
          accent={accent}
        />
        <MetricTile
          icon={ArrowDownCircle}
          label="Consumed this period"
          value={
            <MoneyBadge
              cents={wallet.consumedCents}
              currency={wallet.currency}
            />
          }
          accent={accent}
        />
        <MetricTile
          icon={Clock}
          label="Last top-up"
          value={formatDate(wallet.lastTopUpIso)}
          accent={accent}
        />
      </div>

      {wallet.transactions.length > 0 && (
        <div class="flex flex-col gap-1 rounded-md border bg-muted/10">
          <p class="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent transactions
          </p>
          <ul class="divide-y">
            {wallet.transactions.map((t) => {
              const Icon = t.type === "inbound"
                ? ArrowDownCircle
                : ArrowUpCircle;
              const sign = t.type === "inbound" ? "+" : "-";
              return (
                <li
                  key={t.id}
                  class="flex items-center gap-3 px-3 py-2 text-sm"
                >
                  <Icon
                    class={cn(
                      "size-4 shrink-0",
                      t.type === "inbound"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground",
                    )}
                    aria-hidden="true"
                  />
                  <span class="text-xs text-muted-foreground tabular-nums">
                    {formatDate(t.dateIso)}
                  </span>
                  <span class="ml-auto tabular-nums font-medium">
                    {sign}
                    <MoneyBadge cents={t.cents} currency={wallet.currency} />
                  </span>
                  <span class="w-20 shrink-0 text-right text-xs capitalize text-muted-foreground">
                    {t.status}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * CustomerChargersSection — grid of chargers on the customer dashboard.
 *
 * Each card shows the form-factor icon, friendly name, a status pill, and
 * two actions:
 *
 *   - Start Charging  → POST /api/customer/remote-start (reuses the same
 *                       endpoint the PickChargerModal uses; picks the
 *                       caller's primary active card automatically).
 *                       Disabled when status is `in_use` or `offline`.
 *   - Reserve         → navigates to `/reservations/new?chargeBoxId=…` so
 *                       the existing ReservationWizard can pre-select the
 *                       charger. Disabled when status is `offline`.
 *
 * Status derivation lives on the server (see `routes/index.tsx`); this
 * island is purely presentational + a pending-action overlay per card.
 */

import { useState } from "preact/hooks";
import { CalendarClock, Loader2, Zap } from "lucide-preact";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import {
  chargerFormFactorIcons,
  type FormFactor,
} from "@/components/brand/chargers/index.ts";

export type CustomerChargerStatus =
  | "online"
  | "in_use"
  | "reserved"
  | "offline";

export interface CustomerChargerCardDto {
  chargeBoxId: string;
  friendlyName: string | null;
  formFactor: FormFactor;
  status: CustomerChargerStatus;
}

interface Props {
  chargers: CustomerChargerCardDto[];
}

interface StatusMeta {
  label: string;
  pillClass: string;
  haloClass: string;
}

const STATUS_META: Record<CustomerChargerStatus, StatusMeta> = {
  online: {
    label: "Online",
    pillClass:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    haloClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  in_use: {
    label: "In use",
    pillClass: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30",
    haloClass: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  },
  reserved: {
    label: "Reserved",
    pillClass:
      "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
    haloClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  offline: {
    label: "Offline",
    pillClass: "bg-muted text-muted-foreground border-border",
    haloClass: "bg-muted text-muted-foreground",
  },
};

function reasonStartDisabled(status: CustomerChargerStatus): string | null {
  if (status === "in_use") {
    return "A session is already running on this charger.";
  }
  if (status === "offline") return null;
  return null;
}

function reasonReserveDisabled(status: CustomerChargerStatus): string | null {
  if (status === "offline") return null;
  return null;
}

/** Is the action disabled by status alone (not a reason we want to surface)? */
function startDisabledByStatus(status: CustomerChargerStatus): boolean {
  return status === "offline";
}
function reserveDisabledByStatus(status: CustomerChargerStatus): boolean {
  return status === "offline";
}

export default function CustomerChargersSection({ chargers }: Props) {
  const [pendingId, setPendingId] = useState<string | null>(null);

  const startOn = async (c: CustomerChargerCardDto) => {
    if (pendingId) return;
    const name = c.friendlyName?.trim() || c.chargeBoxId;
    setPendingId(c.chargeBoxId);
    try {
      const resp = await fetch("/api/customer/remote-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chargeBoxId: c.chargeBoxId }),
      });
      if (!resp.ok) {
        const payload = await resp.json().catch(() => ({}));
        const message = (payload as { error?: string }).error ??
          "Couldn't start charging. Please try again.";
        toast.error("Start failed", { description: message });
        return;
      }
      toast.success("Charge starting", {
        description: `Sent start command to ${name}.`,
      });
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : "Network error. Please try again.";
      toast.error("Start failed", { description: message });
    } finally {
      setPendingId(null);
    }
  };

  if (chargers.length === 0) {
    return (
      <p class="text-sm text-muted-foreground">
        No chargers are visible to your account yet.
      </p>
    );
  }

  return (
    <div class="flex flex-col gap-3">
      {chargers.map((c) => {
        const meta = STATUS_META[c.status];
        const Icon = chargerFormFactorIcons[c.formFactor] ??
          chargerFormFactorIcons.generic;
        const startReason = reasonStartDisabled(c.status);
        const reserveReason = reasonReserveDisabled(c.status);
        const startDisabled = startReason !== null ||
          startDisabledByStatus(c.status);
        const reserveDisabled = reserveReason !== null ||
          reserveDisabledByStatus(c.status);
        const name = c.friendlyName?.trim() || c.chargeBoxId;
        const isPending = pendingId === c.chargeBoxId;
        const reserveHref = `/reservations/new?chargeBoxId=${
          encodeURIComponent(c.chargeBoxId)
        }`;

        return (
          <div
            key={c.chargeBoxId}
            class={cn(
              "flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm",
              "sm:flex-row sm:items-center sm:gap-4",
              c.status === "offline" && "opacity-70",
            )}
          >
            <div class="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
              <span
                class={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-md",
                  meta.haloClass,
                )}
                aria-hidden="true"
              >
                <Icon class="size-6" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold leading-tight truncate">
                  {name}
                </p>
                {c.friendlyName && c.friendlyName.trim().length > 0 && (
                  <p class="mt-0.5 text-xs text-muted-foreground truncate">
                    {c.chargeBoxId}
                  </p>
                )}
                <span
                  class={cn(
                    "mt-1 inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    meta.pillClass,
                  )}
                >
                  {c.status === "in_use" && (
                    <span class="relative flex size-1.5 rounded-full bg-sky-500">
                      <span class="absolute inset-0 animate-ping rounded-full bg-sky-400 opacity-75" />
                    </span>
                  )}
                  {meta.label}
                </span>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:justify-end">
              <Button
                size="sm"
                onClick={() => startOn(c)}
                disabled={startDisabled || isPending}
                title={startReason ?? undefined}
                aria-label={`Start charging on ${name}`}
              >
                {isPending
                  ? <Loader2 class="size-4 animate-spin" aria-hidden="true" />
                  : <Zap class="size-4" aria-hidden="true" />}
                <span>Start charging</span>
              </Button>

              {reserveDisabled
                ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled
                    title={reserveReason ?? undefined}
                    aria-label={`Reserve ${name} (disabled)`}
                  >
                    <CalendarClock class="size-4" aria-hidden="true" />
                    <span>Reserve</span>
                  </Button>
                )
                : (
                  <Button
                    size="sm"
                    variant="outline"
                    asChild
                  >
                    <a
                      href={reserveHref}
                      aria-label={`Reserve ${name}`}
                    >
                      <CalendarClock class="size-4" aria-hidden="true" />
                      <span>Reserve</span>
                    </a>
                  </Button>
                )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { useComputed, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { toast } from "sonner";
import {
  ChevronDown,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";

type Tier = "active" | "idle" | "dormant";

interface Transition {
  id: number;
  syncRunId: number;
  level: string;
  message: string;
  context: string | null;
  createdAt: string | null;
}

interface StateResponse {
  currentTier: Tier;
  nextRunAt: string | null;
  lastActivityAt: string | null;
  lastEvaluatedAt: string | null;
  consecutiveIdleTicks: number;
  pinnedUntil?: string | null;
  pinnedTier?: Tier | null;
  recentTransitions?: Transition[];
}

interface SyncControlsProps {
  isAdmin?: boolean;
}

const TIER_STYLES: Record<
  Tier,
  { label: string; dot: string; badge: string; reason: string }
> = {
  active: {
    label: "Active",
    dot: "bg-green-500",
    badge:
      "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30",
    reason:
      "A charging session is in progress (or recently active) — syncing every 15 minutes.",
  },
  idle: {
    label: "Idle",
    dot: "bg-amber-500",
    badge:
      "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    reason:
      "No active sessions but recent tag/transaction activity — syncing hourly.",
  },
  dormant: {
    label: "Dormant",
    dot: "bg-slate-500",
    badge:
      "bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30",
    reason: "No activity for 30+ days — syncing weekly (Sundays 03:00 UTC).",
  },
};

function formatCountdown(ms: number): string {
  if (ms <= 0) return "any moment";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export default function SyncControls({ isAdmin = false }: SyncControlsProps) {
  const loading = useSignal(false);
  const state = useSignal<StateResponse | null>(null);
  const now = useSignal(Date.now());
  const menuOpen = useSignal(false);
  const pinBusy = useSignal(false);
  const triggerDialogOpen = useSignal(false);

  async function fetchState() {
    try {
      const res = await fetch("/api/admin/sync/state");
      if (!res.ok) return;
      const body = await res.json() as StateResponse;
      state.value = body;
    } catch {
      // swallow — this is a best-effort refresh
    }
  }

  useEffect(() => {
    fetchState();
    const refetch = setInterval(fetchState, 30_000);
    const tick = setInterval(() => {
      now.value = Date.now();
    }, 1000);
    return () => {
      clearInterval(refetch);
      clearInterval(tick);
    };
  }, []);

  const tier = useComputed<Tier>(() => state.value?.currentTier ?? "idle");
  const tierStyle = useComputed(() => TIER_STYLES[tier.value]);
  const nextRunLabel = useComputed(() => {
    if (!state.value?.nextRunAt) return "scheduling...";
    const target = new Date(state.value.nextRunAt).getTime();
    return formatCountdown(target - now.value);
  });
  const pinActive = useComputed(() => {
    const until = state.value?.pinnedUntil;
    return !!until && new Date(until).getTime() > now.value;
  });

  function handleResetCadence() {
    triggerDialogOpen.value = true;
  }

  async function confirmResetCadence() {
    triggerDialogOpen.value = false;
    loading.value = true;
    try {
      const res = await fetch("/api/admin/sync/trigger", { method: "POST" });
      if (res.ok) {
        toast.success("Sync triggered");
        // Refresh state quickly so the tier jumps to Active.
        setTimeout(fetchState, 800);
      } else {
        toast.error("Failed to trigger sync");
      }
    } catch {
      toast.error("Failed to trigger sync");
    } finally {
      loading.value = false;
    }
  }

  async function handlePin(
    pinTier: Tier | null,
    hours: number,
  ): Promise<void> {
    pinBusy.value = true;
    try {
      const res = pinTier === null
        ? await fetch("/api/admin/sync/pin", { method: "DELETE" })
        : await fetch("/api/admin/sync/pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier: pinTier, hours }),
        });
      if (!res.ok) {
        toast.error("Failed to update pin");
      } else {
        toast.success(pinTier ? `Pinned to ${pinTier}` : "Pin cleared");
        menuOpen.value = false;
        setTimeout(fetchState, 400);
      }
    } catch {
      toast.error("Failed to update pin");
    } finally {
      pinBusy.value = false;
    }
  }

  return (
    <div className="flex items-center gap-2">
      {/* 1. Status pill — tier badge + countdown. Self-contained card so the
          whole strip reads as three separate widgets, not one band. */}
      <div
        className="flex h-9 items-center gap-2 rounded-md border border-border bg-card/50 px-2.5"
        title={tierStyle.value.reason}
      >
        <span
          className={`inline-block size-2 rounded-full ${tierStyle.value.dot}`}
          aria-hidden="true"
        />
        <div className="flex flex-col leading-tight">
          <span
            className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${tierStyle.value.badge} self-start`}
          >
            {tierStyle.value.label}
            {pinActive.value && (
              <span className="ml-1 opacity-70">(pinned)</span>
            )}
          </span>
          <span className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
            next in {nextRunLabel.value}
          </span>
        </div>
        <Info
          className="size-3.5 text-muted-foreground hidden md:inline"
          aria-hidden="true"
        />
      </div>

      {/* 2. Trigger sync — icon-only square button. Distinct from the status
          pill (no border-l attached) and from the admin button (different
          accent colour, no chevron). */}
      <button
        type="button"
        onClick={handleResetCadence}
        disabled={loading.value}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card/50 text-cyan-600 dark:text-cyan-400 transition-colors hover:bg-cyan-500/10 hover:border-cyan-500/40 disabled:opacity-50"
        title="Trigger a manual sync now"
        aria-label="Trigger a manual sync now"
      >
        {loading.value
          ? <Loader2 className="size-4 animate-spin" />
          : <RefreshCw className="size-4" />}
      </button>

      {/* Accessible confirm replacing browser confirm() */}
      <Dialog
        open={triggerDialogOpen.value}
        onOpenChange={(o) => (triggerDialogOpen.value = o)}
      >
        <DialogContent
          className="sm:max-w-sm"
          onClose={() => (triggerDialogOpen.value = false)}
        >
          <DialogHeader>
            <DialogTitle>Trigger a manual sync?</DialogTitle>
            <DialogDescription>
              The scheduler will run a sync immediately and reset cadence to
              Active. Usually only needed for troubleshooting.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button
              variant="outline"
              onClick={() => (triggerDialogOpen.value = false)}
              autofocus
            >
              Cancel
            </Button>
            <Button onClick={confirmResetCadence}>Trigger sync</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 3. Admin pin dropdown — amber-tinted to flag "destructive-ish admin
          override" vs the neutral trigger button to its left. */}
      {isAdmin && (
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              menuOpen.value = !menuOpen.value;
            }}
            className="flex h-9 items-center gap-1 rounded-md border border-border bg-card/50 px-2 text-amber-600 dark:text-amber-400 transition-colors hover:bg-amber-500/10 hover:border-amber-500/40"
            title="Admin: pin scheduler tier"
            aria-label="Admin: pin scheduler tier"
          >
            <ShieldCheck className="size-4" />
            <ChevronDown className="size-3.5 opacity-70" />
          </button>
          {menuOpen.value && (
            <div className="absolute right-0 top-full mt-1 w-56 rounded-md border border-border bg-card shadow-lg z-50 p-1 text-sm">
              <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                Pin tier for 2h
              </div>
              {(["active", "idle", "dormant"] as Tier[]).map((t) => (
                <button
                  type="button"
                  key={t}
                  disabled={pinBusy.value}
                  onClick={() => handlePin(t, 2)}
                  className="flex w-full items-center gap-2 rounded-sm px-3 py-1.5 hover:bg-muted/50 disabled:opacity-50"
                >
                  <span
                    className={`inline-block size-2 rounded-full ${
                      TIER_STYLES[t].dot
                    }`}
                  />
                  {TIER_STYLES[t].label}
                </button>
              ))}
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                disabled={pinBusy.value || !pinActive.value}
                onClick={() => handlePin(null, 0)}
                className="flex w-full items-center gap-2 rounded-sm px-3 py-1.5 hover:bg-muted/50 disabled:opacity-50"
              >
                Clear pin
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

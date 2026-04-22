import { useEffect } from "preact/hooks";
import { useComputed, useSignal } from "@preact/signals";
import { AlertOctagon, Loader2, RotateCcw, ShieldAlert } from "lucide-preact";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";

interface Snapshot {
  open: boolean;
  consecutiveFailures: number;
  threshold: number;
  disabledUntilMs: number | null;
  cooldownMs: number;
}

interface Props {
  initial?: Snapshot | null;
  currentUserRole?: string;
  /** Poll interval in ms (default 30s). Set to 0 to disable polling. */
  pollMs?: number;
}

const DEFAULT_POLL_MS = 30_000;

function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

/**
 * Sticky red banner shown when the webhook dispatch circuit breaker is open.
 *
 * Polls `/api/admin/webhook-events/circuit-breaker` every `pollMs` (default
 * 30s) to pick up recovery; the countdown updates every 1s client-side.
 * Reset button is admin-only and sits behind a confirm dialog that warns the
 * admin to only reset after the underlying issue is fixed.
 */
export default function CircuitBreakerBanner(
  { initial, currentUserRole, pollMs = DEFAULT_POLL_MS }: Props,
) {
  const snapshot = useSignal<Snapshot | null>(initial ?? null);
  const now = useSignal<number>(Date.now());
  const resetting = useSignal(false);
  const confirmOpen = useSignal(false);

  const isAdmin = currentUserRole === "admin";

  const remainingMs = useComputed(() => {
    const s = snapshot.value;
    if (!s || !s.open || s.disabledUntilMs === null) return 0;
    return Math.max(0, s.disabledUntilMs - now.value);
  });

  const visible = useComputed(() => snapshot.value?.open === true);

  // Poll the breaker state.
  useEffect(() => {
    if (pollMs <= 0) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(
          "/api/admin/webhook-events/circuit-breaker",
        );
        if (!res.ok) return;
        const data = await res.json() as Snapshot;
        if (!cancelled) snapshot.value = data;
      } catch {
        // Silent — polling is best-effort; a transient error shouldn't toast.
      }
    };

    // Fire immediately if we have no initial state (SSR may have omitted it
    // for non-admin users).
    if (!initial) void tick();

    const interval = globalThis.setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      globalThis.clearInterval(interval);
    };
  }, [pollMs, initial, snapshot]);

  // Countdown ticker.
  useEffect(() => {
    const interval = globalThis.setInterval(() => {
      now.value = Date.now();
    }, 1000);
    return () => globalThis.clearInterval(interval);
  }, [now]);

  async function handleReset() {
    if (!isAdmin) return;
    resetting.value = true;
    try {
      const res = await fetch(
        "/api/admin/webhook-events/circuit-breaker",
        { method: "POST" },
      );
      if (!res.ok) {
        toast.error(`Reset failed (${res.status})`);
        return;
      }
      const data = await res.json() as Snapshot & { reset?: boolean };
      snapshot.value = data;
      toast.success("Circuit breaker reset");
      confirmOpen.value = false;
    } catch (err) {
      toast.error(
        `Reset failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      resetting.value = false;
    }
  }

  if (!visible.value) return null;

  const s = snapshot.value!;

  return (
    <>
      <div
        role="alert"
        aria-live="assertive"
        className="sticky top-0 z-40 border-b border-rose-500/40 bg-rose-500/10 backdrop-blur-sm"
      >
        <div className="flex flex-col items-start gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <ShieldAlert
              className="mt-0.5 size-5 shrink-0 text-rose-600 dark:text-rose-400"
              aria-hidden="true"
            />
            <div className="text-sm">
              <div className="font-semibold text-rose-800 dark:text-rose-200">
                Lago webhook dispatch disabled (circuit breaker open)
              </div>
              <div className="text-rose-700/90 dark:text-rose-300/90">
                {s.consecutiveFailures}{" "}
                consecutive dispatch failures hit the threshold of{" "}
                {s.threshold}. Rows are still persisted for audit; new events
                are marked <span className="font-mono text-xs">skipped</span>
                {" "}
                until the breaker closes. Cooldown ends in{" "}
                <span className="font-mono">
                  {formatCountdown(remainingMs.value)}
                </span>.
              </div>
            </div>
          </div>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                confirmOpen.value = true;
              }}
              disabled={resetting.value}
              className="gap-1.5 border-rose-500/40 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300"
            >
              {resetting.value
                ? (
                  <Loader2
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                )
                : <RotateCcw className="size-4" aria-hidden="true" />}
              Reset breaker
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={confirmOpen.value}
        onOpenChange={(open) => {
          if (!open) confirmOpen.value = false;
        }}
      >
        <DialogContent
          onClose={() => {
            confirmOpen.value = false;
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertOctagon
                className="size-5 text-rose-500"
                aria-hidden="true"
              />
              Reset circuit breaker?
            </DialogTitle>
            <DialogDescription>
              Only reset if the underlying issue is fixed. Dispatch will resume
              immediately; if the root cause hasn't been addressed the breaker
              will trip again after the next threshold of failures.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              autoFocus
              variant="outline"
              onClick={() => {
                confirmOpen.value = false;
              }}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={handleReset}
              disabled={resetting.value}
            >
              Reset now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

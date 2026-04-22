/**
 * LiveChargerTicker — tiny "live" status chip for the Dashboard header.
 *
 * Listens for `charger.state` events on the shared SSE backbone (provided by
 * `islands/shared/SseProvider.tsx`) and:
 *   - Flashes a pulsing dot for ~1s on each event.
 *   - Updates an "updated Xs ago" relative timestamp.
 *   - Renders nothing when the SSE backbone is
 *     disconnected (e.g. `ENABLE_SSE=false` on the server or a network blip
 *     the provider hasn't recovered from yet).
 *
 * No toasts; state-transition toast hook can be added later without changing
 * the public shape of this island.
 */

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { sseConnected, subscribeSse } from "@/islands/shared/SseProvider.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

interface Props {
  class?: string;
}

function formatRelative(ms: number | null, nowMs: number): string {
  if (ms === null) return "waiting for events";
  const deltaSec = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (deltaSec < 5) return "just now";
  if (deltaSec < 60) return `updated ${deltaSec}s ago`;
  const min = Math.floor(deltaSec / 60);
  if (min < 60) return `updated ${min}m ago`;
  const hr = Math.floor(min / 60);
  return `updated ${hr}h ago`;
}

export default function LiveChargerTicker({ class: className }: Props) {
  const lastEventAt = useSignal<number | null>(null);
  const flash = useSignal<boolean>(false);
  const now = useSignal<number>(Date.now());

  useEffect(() => {
    let flashTimer: number | undefined;

    const unsubscribe = subscribeSse("charger.state", () => {
      lastEventAt.value = Date.now();
      flash.value = true;
      if (flashTimer !== undefined) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        flash.value = false;
      }, 1000) as unknown as number;
    });

    // Re-render the "X seconds ago" label every second.
    const tickTimer = setInterval(() => {
      now.value = Date.now();
    }, 1000) as unknown as number;

    return () => {
      unsubscribe();
      if (flashTimer !== undefined) clearTimeout(flashTimer);
      clearInterval(tickTimer);
    };
  }, []);

  const connected = sseConnected.value;
  const hasEvent = lastEventAt.value !== null;

  if (!connected && !hasEvent) {
    return null;
  }

  const dotColor = connected ? "bg-green-500" : "bg-amber-500";

  return (
    <div
      class={cn(
        "inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur-sm",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span class="relative flex size-2 items-center justify-center">
        {flash.value
          ? (
            <span
              class={cn(
                "absolute inline-flex size-full animate-ping rounded-full opacity-75",
                dotColor,
              )}
              aria-hidden="true"
            />
          )
          : null}
        <span
          class={cn(
            "relative inline-flex size-2 rounded-full",
            dotColor,
            flash.value ? "ring-2 ring-green-500/50" : "",
          )}
          aria-hidden="true"
        />
      </span>
      <span>
        {connected ? "Live" : "Reconnecting"} ·{" "}
        {formatRelative(lastEventAt.value, now.value)}
      </span>
    </div>
  );
}

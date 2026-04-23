/**
 * ImpersonationBanner — yellow strip shown when an admin is viewing as a
 * customer (`?as=<customerUserId>`).
 *
 * Sticky, full-width, z-35 (above ActiveSessionBanner's z-30 and below the
 * Dialog's z-50). "Exit" calls `POST /api/customer/impersonation/end` and
 * navigates to the returned `redirectTo` (defaults to `/admin`).
 */

import { useState } from "preact/hooks";
import { AlertTriangle, X } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";

interface Props {
  customerName: string;
  customerEmail: string;
  /** URL to send the admin back to after exiting impersonation. */
  redirectTo?: string;
}

export default function ImpersonationBanner(
  { customerName, customerEmail, redirectTo = "/admin" }: Props,
) {
  const [busy, setBusy] = useState(false);

  const exit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/customer/impersonation/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirectTo }),
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        const target = (body && typeof body.redirectTo === "string")
          ? body.redirectTo
          : redirectTo;
        globalThis.location.href = target;
        return;
      }
    } catch (err) {
      console.error("ImpersonationBanner exit failed:", err);
    }
    // Fallback — hard-reload to the admin shell so the URL drops `?as=`.
    globalThis.location.href = redirectTo;
  };

  return (
    <div
      class="sticky top-0 z-[35] flex items-center gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <AlertTriangle
        class="size-4 shrink-0 text-amber-700 dark:text-amber-300"
        aria-hidden="true"
      />
      <p class="flex-1 truncate text-amber-900 dark:text-amber-100">
        Viewing as{" "}
        <span class="font-semibold">{customerName || customerEmail}</span>{" "}
        (Customer) — <span class="font-medium">read-only</span>.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={exit}
        disabled={busy}
        aria-label="Exit impersonation"
        class="border-amber-500/50 hover:bg-amber-500/20"
      >
        <X class="size-3.5" />
        <span>Exit</span>
      </Button>
    </div>
  );
}

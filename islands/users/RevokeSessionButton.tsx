/**
 * RevokeSessionButton — single-session revoke control on the admin
 * user detail page. Sister to the "Revoke all" action; this one
 * targets a specific session row so an admin can drop one suspect
 * device without logging the user out of every other one.
 */

import { useState } from "preact/hooks";
import { Loader2, LogOut } from "lucide-preact";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";

interface RevokeSessionButtonProps {
  userId: string;
  sessionId: string;
  /** When set, callers can refetch / re-render after a successful
   *  revoke. Defaults to a hard reload, which is the cheapest and
   *  most-correct option for a server-rendered page. */
  onRevoked?: () => void;
}

export default function RevokeSessionButton(
  { userId, sessionId, onRevoked }: RevokeSessionButtonProps,
) {
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (busy) return;
    if (!confirm("Revoke this session? The device will be logged out.")) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/user/${encodeURIComponent(userId)}/sessions/${
          encodeURIComponent(sessionId)
        }`,
        { method: "DELETE", credentials: "same-origin" },
      );
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `revoke failed: ${res.status}`);
      }
      toast.success("Session revoked");
      if (onRevoked) {
        onRevoked();
      } else {
        globalThis.location.reload();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revoke failed");
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      class="text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
      onClick={onClick}
      disabled={busy}
      aria-label="Revoke this session"
    >
      {busy
        ? <Loader2 class="size-3.5 animate-spin" aria-hidden />
        : <LogOut class="size-3.5" aria-hidden />}
    </Button>
  );
}

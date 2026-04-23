/**
 * CustomerSignOutButton — POST /api/auth/sign-out + redirect.
 *
 * Polaris Track G3 — kept as a small island so the Account page's "Sign
 * out" SectionCard renders inert chrome on the server but still has a
 * working button on hydration.
 *
 * Mirrors the implementation already in `islands/UserMenu.tsx` so the
 * behaviour stays consistent across surfaces.
 */

import { useState } from "preact/hooks";
import { Loader2, LogOut } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";

export default function CustomerSignOutButton() {
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/sign-out", { method: "POST" });
    } catch {
      // Non-fatal — still navigate.
    }
    globalThis.location.href = "/login";
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="mobile"
      onClick={signOut}
      disabled={busy}
      class="border-rose-500/40 text-rose-700 hover:bg-rose-500/10 dark:text-rose-400"
    >
      {busy
        ? <Loader2 class="size-4 animate-spin" aria-hidden="true" />
        : <LogOut class="size-4" aria-hidden="true" />}
      Sign out
    </Button>
  );
}

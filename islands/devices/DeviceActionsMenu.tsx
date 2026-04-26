/**
 * DeviceActionsMenu — row-level action menu for a device.
 *
 * Three actions:
 *   - View         → navigates to /admin/devices/{deviceId}
 *   - Rename       → inline popover with a text input → POST .../rename
 *   - Deregister   → destructive confirm dialog → POST .../deregister
 *
 * Mirrors the spirit of `islands/charger-actions/RemoteActionsPanel.tsx`
 * (uses `ConfirmDialog` for destructive ops, surfaces a toast on success).
 *
 * Layout variants:
 *   - `compact: true`   → single dropdown trigger (used in card / table rows)
 *   - default           → inline button row (used in detail-page header)
 */

import { useState } from "preact/hooks";
import { Eye, MoreVertical, Pencil, ShieldOff, Trash2 } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog.tsx";
import { toast } from "sonner";

interface Props {
  deviceId: string;
  label: string;
  kind: "phone_nfc" | "laptop_nfc";
  /** Compact mode renders a single dropdown trigger instead of inline buttons. */
  compact?: boolean;
  /**
   * Override for the post-action redirect target. Defaults to a soft reload of
   * the current URL so the listing/detail page reflects the mutation.
   */
  redirectTo?: string;
}

export default function DeviceActionsMenu(
  { deviceId, label, kind, compact = false, redirectTo }: Props,
) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(label);
  const [renameLoading, setRenameLoading] = useState(false);
  const [deregisterLoading, setDeregisterLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const refresh = () => {
    if (typeof globalThis.location === "undefined") return;
    if (redirectTo) {
      globalThis.location.href = redirectTo;
    } else {
      globalThis.location.reload();
    }
  };

  const submitRename = async (e?: Event) => {
    e?.preventDefault();
    const trimmed = renameValue.trim();
    if (trimmed.length === 0) {
      setRenameError("Label can't be empty.");
      return;
    }
    if (trimmed.length > 80) {
      setRenameError("Max 80 characters.");
      return;
    }
    setRenameError(null);
    setRenameLoading(true);
    try {
      const res = await fetch(`/api/admin/devices/${deviceId}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });
      if (!res.ok) {
        const text = await res.text();
        setRenameError(`Rename failed (${res.status}): ${text}`);
        return;
      }
      toast.success(`Renamed to "${trimmed}"`);
      setRenameOpen(false);
      refresh();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenameLoading(false);
    }
  };

  const submitDeregister = async () => {
    setDeregisterLoading(true);
    try {
      const res = await fetch(`/api/admin/devices/${deviceId}/deregister`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "admin_ui" }),
      });
      if (!res.ok) {
        const text = await res.text();
        toast.error(`Deregister failed (${res.status}): ${text}`);
        return;
      }
      toast.success(`Device "${label}" deregistered`);
      setConfirmOpen(false);
      // After deregister we always go back to the listing — the detail page
      // would otherwise show a tombstone with no action affordance.
      if (redirectTo) {
        globalThis.location.href = redirectTo;
      } else {
        globalThis.location.href = "/admin/devices";
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDeregisterLoading(false);
    }
  };

  const renameDialog = renameOpen
    ? (
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent onClose={() => setRenameOpen(false)}>
          <DialogHeader>
            <DialogTitle>Rename device</DialogTitle>
            <DialogDescription>
              Pick a label that admins will see in lists. Visible to the device
              owner too.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitRename} class="flex flex-col gap-2">
            <Input
              type="text"
              value={renameValue}
              onInput={(e) =>
                setRenameValue((e.currentTarget as HTMLInputElement).value)}
              maxLength={80}
              autoFocus
              disabled={renameLoading}
            />
            {renameError && (
              <p class="text-sm text-destructive">{renameError}</p>
            )}
            <DialogFooter className="mt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameOpen(false)}
                disabled={renameLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="default"
                disabled={renameLoading || renameValue.trim().length === 0}
              >
                {renameLoading ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    )
    : null;

  const deregisterConfirm = (
    <ConfirmDialog
      open={confirmOpen}
      onOpenChange={setConfirmOpen}
      title="Force deregister device?"
      description={
        <>
          This soft-deletes <strong>{label}</strong>{" "}
          and revokes every active bearer token. The owner will be signed out on
          next request and the {kind === "phone_nfc" ? "phone" : "laptop"}{" "}
          must re-register. This cannot be undone via the admin UI.
        </>
      }
      confirmLabel={deregisterLoading ? "Deregistering…" : "Force deregister"}
      cancelLabel="Cancel"
      variant="destructive"
      icon={<ShieldOff class="size-4 text-rose-500" aria-hidden="true" />}
      typeToConfirmPhrase={label}
      onConfirm={submitDeregister}
      isLoading={deregisterLoading}
    />
  );

  if (compact) {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Device actions"
              class="size-8 p-0"
            >
              <MoreVertical class="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              asChild
            >
              <a href={`/admin/devices/${deviceId}`}>
                <Eye class="size-4" />
                View
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setRenameValue(label);
                setRenameError(null);
                setRenameOpen(true);
              }}
            >
              <Pencil class="size-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirmOpen(true)}
            >
              <Trash2 class="size-4" />
              Force deregister
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {renameDialog}
        {deregisterConfirm}
      </>
    );
  }

  // Inline mode — used in detail-page header.
  return (
    <>
      <div class="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setRenameValue(label);
            setRenameError(null);
            setRenameOpen(true);
          }}
        >
          <Pencil class="size-4" />
          Rename
        </Button>
        <Button
          size="sm"
          variant="outline"
          class="text-rose-600 hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-400"
          onClick={() => setConfirmOpen(true)}
        >
          <ShieldOff class="size-4" />
          Force deregister
        </Button>
      </div>
      {renameDialog}
      {deregisterConfirm}
    </>
  );
}

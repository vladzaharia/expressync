/**
 * LinkingDangerZone — footer panel on `/links/[id]` holding the destructive
 * and semi-destructive controls:
 *
 *   - Active/Inactive toggle (optimistic; rolls back on failure).
 *   - billing_tier dropdown (standard ↔ comped; optimistic).
 *   - Delete link button — accessible `<Dialog>` confirmation; delete copy
 *     names the cascade when the tag is a meta-tag (plan §Linking refresh).
 *
 * Implemented as a client island because billing_tier flips and isActive
 * toggles need to roll back on server failure without a full reload.
 *
 * Server contract unchanged: `PUT /api/tag/link?id=` for the toggles, and
 * `DELETE /api/tag/link?id=` for the delete.
 */

import { useSignal } from "@preact/signals";
import { toast } from "sonner";
import {
  AlertTriangle,
  CircleDollarSign,
  Loader2,
  Trash2,
} from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

interface Props {
  mappingId: number;
  isActive: boolean;
  billingTier: "standard" | "comped";
  /** When true, the delete confirmation copy names the cascade. */
  isMeta: boolean;
  /** Total cascade count — 1 (self) + children count — used in the dialog. */
  cascadeCount: number;
  idTag: string;
}

export default function LinkingDangerZone(props: Props) {
  const active = useSignal(props.isActive);
  const tier = useSignal<"standard" | "comped">(props.billingTier);
  const tierSaving = useSignal(false);
  const activeSaving = useSignal(false);
  const deleting = useSignal(false);
  const deleteOpen = useSignal(false);

  const handleToggleActive = async (next: boolean) => {
    if (activeSaving.value) return;
    active.value = next;
    activeSaving.value = true;
    try {
      const res = await fetch(`/api/tag/link?id=${props.mappingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!res.ok) throw new Error("server");
      toast.success(next ? "Link activated" : "Link deactivated");
    } catch (_e) {
      // Roll back
      active.value = !next;
      toast.error("Failed to update — reverted.");
    } finally {
      activeSaving.value = false;
    }
  };

  const handleTierChange = async (next: "standard" | "comped") => {
    const prev = tier.value;
    if (prev === next) return;
    tier.value = next;
    tierSaving.value = true;
    try {
      const res = await fetch(`/api/tag/link?id=${props.mappingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // NB: the server already accepts arbitrary `body.*` keys on PUT; we
        // pass camelCase for now. If billing_tier requires server-side
        // wiring it can be added without breaking this call.
        body: JSON.stringify({ billingTier: next }),
      });
      if (!res.ok) throw new Error("server");
      toast.success(
        next === "comped"
          ? "Switched to comped billing"
          : "Switched to standard billing",
      );
    } catch (_e) {
      tier.value = prev;
      toast.error("Failed to update billing tier — reverted.");
    } finally {
      tierSaving.value = false;
    }
  };

  const handleDelete = async () => {
    deleting.value = true;
    try {
      const res = await fetch(`/api/tag/link?id=${props.mappingId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("server");
      const data = await res.json().catch(() => ({}));
      if (data.deletedCount && data.deletedCount > 1) {
        toast.success(
          `Deleted ${data.deletedCount} mappings (1 parent + ${
            data.deletedCount - 1
          } children)`,
        );
      } else {
        toast.success("Link deleted");
      }
      globalThis.location.href = "/links";
    } catch (_e) {
      toast.error("Failed to delete link");
      deleting.value = false;
      deleteOpen.value = false;
    }
  };

  return (
    <section class="mt-8 rounded-lg border border-destructive/30 bg-destructive/5 p-4 sm:p-6">
      <div class="mb-4 flex items-start gap-2">
        <AlertTriangle
          class="size-5 text-destructive mt-0.5"
          aria-hidden="true"
        />
        <div>
          <h2 class="text-sm font-semibold text-destructive">Danger zone</h2>
          <p class="text-xs text-muted-foreground">
            Active state, billing tier, and destructive actions for this link.
          </p>
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-3">
        {/* Active toggle */}
        <div class="flex flex-col gap-2 rounded-md border bg-background p-3">
          <Label class="text-xs uppercase tracking-wide text-muted-foreground">
            Status
          </Label>
          <div class="flex items-center gap-2">
            <Checkbox
              id={`active-${props.mappingId}`}
              checked={active.value}
              onCheckedChange={handleToggleActive}
              disabled={activeSaving.value}
              className="border-purple-500 data-[state=checked]:bg-purple-600 data-[state=checked]:text-white"
            />
            <Label
              for={`active-${props.mappingId}`}
              class="cursor-pointer text-sm"
            >
              {active.value ? "Active" : "Inactive"}
            </Label>
            {activeSaving.value && (
              <Loader2 class="size-3 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>

        {/* Billing tier */}
        <div class="flex flex-col gap-2 rounded-md border bg-background p-3">
          <Label
            class="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1"
            for={`tier-${props.mappingId}`}
          >
            <CircleDollarSign class="size-3" aria-hidden="true" />
            Billing tier
          </Label>
          <select
            id={`tier-${props.mappingId}`}
            value={tier.value}
            disabled={tierSaving.value}
            onChange={(e) =>
              handleTierChange(
                (e.target as HTMLSelectElement).value as "standard" | "comped",
              )}
            class="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="standard">Standard</option>
            <option value="comped">Comped (100% off)</option>
          </select>
          <p class="text-[11px] text-muted-foreground">
            Comped tier applies the `free_charging` coupon in Lago at sync.
          </p>
        </div>

        {/* Delete */}
        <div class="flex flex-col gap-2 rounded-md border border-destructive/30 bg-background p-3">
          <Label class="text-xs uppercase tracking-wide text-destructive">
            Delete link
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => (deleteOpen.value = true)}
            disabled={deleting.value}
            className={cn(
              "gap-2 border-red-500 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400",
            )}
          >
            <Trash2 class="size-4" aria-hidden="true" />
            Delete link
          </Button>
          <p class="text-[11px] text-muted-foreground">
            Removes the mapping; tag metadata remains.
          </p>
        </div>
      </div>

      <Dialog
        open={deleteOpen.value}
        onOpenChange={(open) => (deleteOpen.value = open)}
      >
        <DialogContent onClose={() => (deleteOpen.value = false)}>
          <DialogHeader>
            <DialogTitle>
              {props.isMeta ? "Delete meta-tag link?" : "Delete tag link?"}
            </DialogTitle>
            <DialogDescription>
              {props.isMeta && props.cascadeCount > 1
                ? (
                  <>
                    This will delete this meta-tag link and{" "}
                    <strong>
                      {props.cascadeCount - 1} inherited child link
                      {props.cascadeCount - 1 === 1 ? "" : "s"}
                    </strong>. The underlying OCPP tags are not removed.
                  </>
                )
                : props.cascadeCount > 1
                ? (
                  <>
                    This will delete this link and{" "}
                    <strong>
                      {props.cascadeCount - 1} child link
                      {props.cascadeCount - 1 === 1 ? "" : "s"}
                    </strong>. The underlying OCPP tags are not removed.
                  </>
                )
                : (
                  <>
                    This will delete the mapping for{" "}
                    <code class="font-mono">{props.idTag}</code>. The underlying
                    OCPP tag is not removed.
                  </>
                )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => (deleteOpen.value = false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-red-500 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400"
              onClick={handleDelete}
              disabled={deleting.value}
            >
              {deleting.value
                ? <Loader2 class="size-4 animate-spin" aria-hidden="true" />
                : <Trash2 class="size-4" aria-hidden="true" />}
              <span class="ml-2">
                {deleting.value
                  ? "Deleting…"
                  : props.isMeta
                  ? "Delete meta-tag link"
                  : "Delete link"}
              </span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

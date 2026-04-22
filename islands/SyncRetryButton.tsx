/**
 * SyncRetryButton — admin-only "Retry from this run" action for a failed
 * sync on `/sync/[id]`. Posts to `/api/sync/trigger` after `ConfirmDialog`.
 *
 * The trigger endpoint is global (it kicks the scheduler) rather than
 * per-run, so "retry from this run" really means "kick off a new sync now";
 * surfacing the button on the failed run's page lets an operator recover
 * from a failure without navigating away.
 */

import { useSignal } from "@preact/signals";
import { toast } from "sonner";
import { RefreshCw } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog.tsx";

interface Props {
  runId: number;
}

export default function SyncRetryButton({ runId }: Props) {
  const open = useSignal(false);
  const busy = useSignal(false);

  async function confirm() {
    busy.value = true;
    try {
      const res = await fetch("/api/sync/trigger", { method: "POST" });
      if (res.ok) {
        toast.success("Sync triggered");
        open.value = false;
        setTimeout(() => globalThis.location.reload(), 600);
      } else {
        toast.error("Failed to trigger sync");
      }
    } catch {
      toast.error("Failed to trigger sync");
    } finally {
      busy.value = false;
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          open.value = true;
        }}
      >
        <RefreshCw class="size-4" />
        <span>Retry from this run</span>
      </Button>
      <ConfirmDialog
        open={open.value}
        onOpenChange={(o) => (open.value = o)}
        title={`Retry sync from run #${runId}?`}
        description="A new sync run will be started immediately. This is a global trigger — the scheduler will re-run and may pick up any transactions or tag state that the failed run left behind."
        confirmLabel="Trigger sync"
        onConfirm={confirm}
        isLoading={busy.value}
        icon={<RefreshCw class="size-5 text-primary" />}
      />
    </>
  );
}

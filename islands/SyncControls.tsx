import { useSignal } from "@preact/signals";
import { Button } from "@/components/ui/button.tsx";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";

export default function SyncControls() {
  const loading = useSignal(false);
  const message = useSignal("");
  const success = useSignal(false);

  const handleTriggerSync = async () => {
    if (!confirm("Trigger a manual sync now?")) return;

    loading.value = true;
    message.value = "";
    success.value = false;

    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (res.ok) {
        message.value = "Sync triggered successfully!";
        success.value = true;
        setTimeout(() => {
          globalThis.location.reload();
        }, 1500);
      } else {
        const data = await res.json();
        message.value = data.error || "Failed to trigger sync";
        success.value = false;
      }
    } catch (_e) {
      message.value = "An error occurred";
      success.value = false;
    } finally {
      loading.value = false;
    }
  };

  return (
    <div className="flex items-center gap-4">
      {message.value && (
        <div
          className={cn(
            "flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-lg",
            success.value
              ? "text-accent bg-accent/10"
              : "text-destructive bg-destructive/10",
          )}
        >
          {success.value
            ? <CheckCircle2 className="size-4" />
            : <AlertCircle className="size-4" />}
          {message.value}
        </div>
      )}
      <Button
        onClick={handleTriggerSync}
        disabled={loading.value}
        className={cn(
          "relative overflow-hidden transition-all duration-300",
          !loading.value && "hover:shadow-lg hover:shadow-primary/25",
        )}
      >
        {loading.value
          ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Syncing...
            </>
          )
          : (
            <>
              <RefreshCw className="mr-2 size-4" />
              Trigger Sync
            </>
          )}
        {!loading.value && (
          <span className="absolute inset-0 rounded-md bg-primary/20 animate-pulse" />
        )}
      </Button>
    </div>
  );
}

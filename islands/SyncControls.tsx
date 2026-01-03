import { useSignal } from "@preact/signals";
import { Button } from "@/components/ui/button.tsx";
import { RefreshCw, Loader2 } from "lucide-preact";

export default function SyncControls() {
  const loading = useSignal(false);
  const message = useSignal("");

  const handleTriggerSync = async () => {
    if (!confirm("Trigger a manual sync now?")) return;

    loading.value = true;
    message.value = "";

    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (res.ok) {
        message.value = "Sync triggered successfully!";
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        const data = await res.json();
        message.value = data.error || "Failed to trigger sync";
      }
    } catch (_e) {
      message.value = "An error occurred";
    } finally {
      loading.value = false;
    }
  };

  return (
    <div className="flex items-center gap-4">
      {message.value && (
        <span
          className={`text-sm ${
            message.value.includes("success")
              ? "text-green-600"
              : "text-destructive"
          }`}
        >
          {message.value}
        </span>
      )}
      <Button onClick={handleTriggerSync} disabled={loading.value}>
        {loading.value ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            Syncing...
          </>
        ) : (
          <>
            <RefreshCw className="mr-2 size-4" />
            Trigger Sync
          </>
        )}
      </Button>
    </div>
  );
}


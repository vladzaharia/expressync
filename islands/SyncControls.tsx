import { useSignal } from "@preact/signals";
import { Loader2, RefreshCw } from "lucide-preact";
import { CHROME_SIZE } from "@/components/AppSidebar.tsx";

export default function SyncControls() {
  const loading = useSignal(false);

  const handleTriggerSync = async () => {
    if (!confirm("Trigger a manual sync now?")) return;

    loading.value = true;

    try {
      const res = await fetch("/api/sync/trigger", { method: "POST" });
      if (res.ok) {
        setTimeout(() => {
          globalThis.location.reload();
        }, 500);
      }
    } catch (_e) {
      // Silent fail
    } finally {
      loading.value = false;
    }
  };

  return (
    <button
      onClick={handleTriggerSync}
      disabled={loading.value}
      className="flex items-center justify-center gap-2 px-4 h-full transition-colors disabled:opacity-50"
      style={{ height: CHROME_SIZE }}
    >
      {loading.value
        ? <Loader2 className="size-5 animate-spin" />
        : <RefreshCw className="size-5" />}
      <span className="text-sm font-medium hidden sm:inline">
        {loading.value ? "Syncing..." : "Trigger Sync"}
      </span>
    </button>
  );
}

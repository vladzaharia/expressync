import { useSignal } from "@preact/signals";

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
    <div class="flex items-center gap-4">
      {message.value && (
        <span
          class={`text-sm ${
            message.value.includes("success")
              ? "text-green-600"
              : "text-red-600"
          }`}
        >
          {message.value}
        </span>
      )}
      <button
        onClick={handleTriggerSync}
        disabled={loading.value}
        class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading.value ? "Triggering..." : "Trigger Sync"}
      </button>
    </div>
  );
}


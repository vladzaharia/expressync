import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Button } from "@/components/ui/button.tsx";
import { Download, Loader2 } from "lucide-preact";
import { toast } from "sonner";

interface Props {
  invoiceId: string;
  initialFileUrl: string | null;
}

/**
 * Polls `POST /api/invoice/[id]/pdf` + `POST /api/invoice/[id]/refresh`
 * until a `file_url` appears. Each fetch is bound to an AbortController so
 * navigating away stops the polling cleanly.
 */
export default function InvoicePdfLink({
  invoiceId,
  initialFileUrl,
}: Props) {
  const fileUrl = useSignal<string | null>(initialFileUrl);
  const busy = useSignal(false);

  useEffect(() => () => busy.value = false, []);

  const requestPdf = async () => {
    if (busy.value) return;
    busy.value = true;

    const ac = new AbortController();
    const signal = ac.signal;

    try {
      const res = await fetch(
        `/api/invoice/${encodeURIComponent(invoiceId)}/pdf`,
        { method: "POST", signal },
      );

      if (res.status === 200) {
        const data = await res.json().catch(() => null);
        if (data?.fileUrl) {
          fileUrl.value = data.fileUrl;
          globalThis.open(data.fileUrl, "_blank", "noopener,noreferrer");
          return;
        }
      }

      if (res.status !== 202) {
        toast.error("Failed to request PDF");
        return;
      }

      // 202 → poll /refresh every 2 seconds up to 10 seconds
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && !signal.aborted) {
        await new Promise((r) => setTimeout(r, 2000));
        if (signal.aborted) return;
        const refreshRes = await fetch(
          `/api/invoice/${encodeURIComponent(invoiceId)}/refresh`,
          { method: "POST", signal },
        );
        if (refreshRes.ok) {
          const refreshed = await refreshRes.json().catch(() => null);
          if (refreshed?.fileUrl) {
            fileUrl.value = refreshed.fileUrl;
            globalThis.open(refreshed.fileUrl, "_blank", "noopener,noreferrer");
            return;
          }
        }
      }

      toast.message("PDF still generating; try again in a moment.");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("InvoicePdfLink error", err);
        toast.error("Failed to download PDF");
      }
    } finally {
      busy.value = false;
    }
  };

  if (fileUrl.value) {
    return (
      <Button variant="outline" size="sm" asChild>
        <a
          href={fileUrl.value}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Download PDF (opens in new tab)"
        >
          <Download className="size-4" aria-hidden="true" />
          Download PDF
        </a>
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={requestPdf}
      disabled={busy.value}
      aria-label="Generate invoice PDF"
    >
      {busy.value
        ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        : <Download className="size-4" aria-hidden="true" />}
      {busy.value ? "Generating…" : "Download PDF"}
    </Button>
  );
}

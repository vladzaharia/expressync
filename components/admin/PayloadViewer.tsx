import { useSignal } from "@preact/signals";
import { ChevronDown, ChevronRight, Copy } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { toast } from "sonner";

interface PayloadViewerProps {
  payload: unknown;
  /** Line threshold before the viewer collapses (default 500). */
  truncateAt?: number;
  className?: string;
}

/**
 * JSON payload viewer with copy-to-clipboard + truncation for huge payloads.
 *
 * Intentionally simple: we stringify with 2-space indent, then inject a light
 * per-line dim rendering rather than pulling in a full syntax highlighter.
 * If the payload exceeds `truncateAt` lines, we show the first slice with a
 * "Show more" control.
 */
export function PayloadViewer(
  { payload, truncateAt = 500, className }: PayloadViewerProps,
) {
  const expanded = useSignal(false);

  const json = (() => {
    try {
      return JSON.stringify(payload ?? {}, null, 2);
    } catch {
      return "// Failed to stringify payload";
    }
  })();

  const lines = json.split("\n");
  const truncated = !expanded.value && lines.length > truncateAt;
  const shown = truncated ? lines.slice(0, truncateAt).join("\n") : json;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      toast.success("Payload copied to clipboard");
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-slate-500/20 bg-slate-500/5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-500/20 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          Raw payload
          <span className="ml-2 font-mono text-[0.65rem] opacity-70">
            {lines.length} lines
          </span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 gap-1.5 text-xs"
        >
          <Copy className="size-3" aria-hidden="true" />
          Copy
        </Button>
      </div>
      <pre className="max-h-[32rem] overflow-auto p-4 font-mono text-xs leading-relaxed text-slate-800 dark:text-slate-200">
        {shown}
      </pre>
      {truncated && (
        <div className="border-t border-slate-500/20 bg-slate-500/5 px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              expanded.value = true;
            }}
            className="h-7 gap-1.5 text-xs"
          >
            <ChevronDown className="size-3" aria-hidden="true" />
            Show all {lines.length} lines
          </Button>
        </div>
      )}
      {!truncated && expanded.value && lines.length > truncateAt && (
        <div className="border-t border-slate-500/20 bg-slate-500/5 px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              expanded.value = false;
            }}
            className="h-7 gap-1.5 text-xs"
          >
            <ChevronRight className="size-3" aria-hidden="true" />
            Collapse
          </Button>
        </div>
      )}
    </div>
  );
}

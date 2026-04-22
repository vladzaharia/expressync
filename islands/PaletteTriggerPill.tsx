import { cn } from "@/src/lib/utils/cn.ts";
import { Search } from "lucide-preact";

/**
 * Visible trigger for the global Command Palette (CommandPalette island).
 *
 * Decoupled: dispatches a `cmdk:open` CustomEvent that the palette island
 * listens for, so this component never imports the palette directly.
 */
export default function PaletteTriggerPill() {
  const open = () => globalThis.dispatchEvent(new CustomEvent("cmdk:open"));
  return (
    <button
      type="button"
      onClick={open}
      className={cn(
        "hidden md:flex items-center gap-2 h-9 px-3 mx-2 rounded-full",
        "bg-muted/40 hover:bg-muted transition-colors",
        "text-sm text-muted-foreground",
        "border border-border/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      aria-label="Open command palette"
    >
      <Search className="size-4" aria-hidden="true" />
      <span class="text-xs">Search or jump…</span>
      <kbd class="ml-2 px-1.5 py-0.5 text-[10px] font-mono bg-background/80 rounded border border-border/60">
        ⌘K
      </kbd>
    </button>
  );
}

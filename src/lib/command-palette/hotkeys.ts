/**
 * Command Palette hotkey helpers (Phase P6).
 *
 * - `isTextInput` detects whether the currently-focused element is an input,
 *   textarea, or contentEditable region; hotkey handlers MUST bail in that
 *   case so typing in forms still works.
 * - `attachPaletteHotkeys` wires the global keyboard listener that toggles
 *   the palette on ⌘K / Ctrl+K / `/` and closes on Esc. Returns a detach
 *   function for cleanup from `useEffect`.
 */

export function isTextInput(el: Element | null): boolean {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  const he = el as HTMLElement;
  if (he.isContentEditable) return true;
  return false;
}

export interface PaletteHotkeyOptions {
  /** Called when the user wants to open the palette. */
  open: () => void;
  /** Called when the user wants to close (Esc). */
  close: () => void;
  /** Called on each keypress to check if the palette is already open. */
  isOpen: () => boolean;
}

export function attachPaletteHotkeys(
  opts: PaletteHotkeyOptions,
): () => void {
  const handler = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;

    // ⌘K / Ctrl+K — toggle
    if (mod && (key === "k" || key === "K")) {
      e.preventDefault();
      if (opts.isOpen()) opts.close();
      else opts.open();
      return;
    }

    // `/` — open (non-input pages)
    if (key === "/" && !mod && !e.altKey) {
      if (isTextInput(document.activeElement)) return;
      if (opts.isOpen()) return;
      e.preventDefault();
      opts.open();
      return;
    }

    // Esc — close when open
    if (key === "Escape" && opts.isOpen()) {
      opts.close();
      return;
    }
  };

  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}

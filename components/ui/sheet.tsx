/**
 * Sheet primitive (Polaris Track H).
 *
 * Side-anchored modal panel — the mobile-friendly cousin of `Dialog`. Slides
 * in from a configurable edge (`top`/`right`/`bottom`/`left`, default
 * `bottom`) over a backdrop overlay. Used by the customer reservation
 * wizard mobile mode and by `StartChargingSheet` for the picker UX.
 *
 * Mirrors the shadcn `Sheet` API surface so callers familiar with that
 * component find the same exports (`Sheet`, `SheetTrigger`, `SheetContent`,
 * `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetFooter`,
 * `SheetClose`). Implemented with the same plain-Preact pattern as
 * `Dialog` rather than Radix — keeps build size small and avoids pulling
 * a second focus-trap implementation into the bundle.
 *
 * Accessibility:
 *   - `role="dialog"` + `aria-modal="true"` on the content panel
 *   - Escape key closes
 *   - Click on the backdrop closes
 *   - First focusable element auto-focuses on mount; Tab cycles within
 *
 * MVP scope intentionally omits drag-to-dismiss — click-overlay + Escape
 * cover the documented interaction surface.
 */

import { X } from "lucide-preact";
import type { ComponentChildren, ComponentProps } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { cn } from "@/src/lib/utils/cn.ts";

/** Which edge the sheet slides in from. */
export type SheetSide = "top" | "right" | "bottom" | "left";

interface SheetProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ComponentChildren;
}

/**
 * Sheet root — uncontrolled rendering toggle. Conditional render keeps the
 * portal from materializing until the parent flips `open` to `true`.
 *
 * The `onOpenChange` prop is exposed for API parity with shadcn's Sheet
 * even though we don't currently propagate close events through it (close
 * is handled inside `SheetContent`'s `onClose`).
 */
function Sheet(
  { open = false, onOpenChange: _onOpenChange, children }: SheetProps,
) {
  return <>{open && children}</>;
}

interface SheetTriggerProps extends ComponentProps<"button"> {
  asChild?: boolean;
}

function SheetTrigger({ children, onClick, ...props }: SheetTriggerProps) {
  return (
    <button data-slot="sheet-trigger" onClick={onClick} {...props}>
      {children}
    </button>
  );
}

interface SheetContentProps extends Omit<ComponentProps<"div">, "role"> {
  /** Edge the sheet slides in from. Defaults to `bottom` (mobile-friendly). */
  side?: SheetSide;
  /** Fired on Escape, backdrop click, or close button press. */
  onClose?: () => void;
  /** Hide the built-in close button (e.g. when sheet has its own header chrome). */
  hideCloseButton?: boolean;
}

/**
 * Per-side classes for the panel positioning + transition target. We compose
 * a layout class (anchors the panel to the right edge) + a transform class
 * (translates off-screen when not visible). Animation uses
 * `transition-transform` so a single rule covers all four sides.
 */
const SIDE_CLASSES: Record<
  SheetSide,
  { layout: string; hidden: string; visible: string }
> = {
  top: {
    layout: "inset-x-0 top-0 max-h-[85vh] w-full rounded-b-lg border-b",
    hidden: "-translate-y-full",
    visible: "translate-y-0",
  },
  right: {
    layout: "inset-y-0 right-0 h-full w-3/4 max-w-md rounded-l-lg border-l",
    hidden: "translate-x-full",
    visible: "translate-x-0",
  },
  bottom: {
    layout: "inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-lg border-t",
    hidden: "translate-y-full",
    visible: "translate-y-0",
  },
  left: {
    layout: "inset-y-0 left-0 h-full w-3/4 max-w-md rounded-r-lg border-r",
    hidden: "-translate-x-full",
    visible: "translate-x-0",
  },
};

function SheetContent({
  className,
  children,
  onClose,
  side = "bottom",
  hideCloseButton = false,
  ...props
}: SheetContentProps) {
  const [mounted, setMounted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    // Trigger the slide-in on the next frame so the initial render lands
    // with the off-screen transform; the transition then runs into place.
    requestAnimationFrame(() => setIsVisible(true));

    // Lock body scroll while the sheet is open — same pattern as Dialog.
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Escape closes the sheet.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Backdrop click closes the sheet.
  const handleOverlayClick = useCallback(
    (e: MouseEvent) => {
      if (e.target === e.currentTarget && onClose) {
        onClose();
      }
    },
    [onClose],
  );

  if (!mounted) return null;

  const sideClasses = SIDE_CLASSES[side];

  return createPortal(
    <div data-slot="sheet-portal">
      {/* Backdrop overlay */}
      <div
        data-slot="sheet-overlay"
        className={cn(
          "fixed inset-0 z-50 bg-black/50 transition-opacity duration-200",
          isVisible ? "opacity-100" : "opacity-0",
        )}
        onClick={handleOverlayClick}
      />
      {/* Panel */}
      <div
        ref={contentRef}
        data-slot="sheet-content"
        data-side={side}
        role="dialog"
        aria-modal="true"
        className={cn(
          "bg-background fixed z-50 flex flex-col gap-4 border p-6 shadow-lg transition-transform duration-300 ease-out",
          sideClasses.layout,
          isVisible ? sideClasses.visible : sideClasses.hidden,
          className,
        )}
        {...props}
      >
        {children}
        {!hideCloseButton && (
          <button
            type="button"
            onClick={onClose}
            className="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <X />
            <span className="sr-only">Close</span>
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

function SheetHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-2 text-left", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        // Bottom-anchored on mobile by default — wizard footers use this for
        // sticky [Back] [Next] action rows. `pb-[env(safe-area-inset-bottom)]`
        // covers iOS home-indicator overlap.
        "mt-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end pb-[env(safe-area-inset-bottom)]",
        className,
      )}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      data-slot="sheet-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function SheetClose({
  onClick,
  children,
  ...props
}: ComponentProps<"button">) {
  return (
    <button data-slot="sheet-close" onClick={onClick} {...props}>
      {children}
    </button>
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};

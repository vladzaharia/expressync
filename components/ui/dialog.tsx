import { X } from "lucide-preact";
import type { ComponentChildren, ComponentProps } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { createPortal } from "preact/compat";
import { cn } from "@/src/lib/utils/cn.ts";

interface DialogContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ComponentChildren;
}

function Dialog(
  { open = false, onOpenChange: _onOpenChange, children }: DialogProps,
) {
  return <>{open && children}</>;
}

interface DialogTriggerProps extends ComponentProps<"button"> {
  asChild?: boolean;
}

function DialogTrigger({ children, onClick, ...props }: DialogTriggerProps) {
  return (
    <button data-slot="dialog-trigger" onClick={onClick} {...props}>
      {children}
    </button>
  );
}

interface DialogContentProps extends Omit<ComponentProps<"div">, "role"> {
  onClose?: () => void;
}

function DialogContent({
  className,
  children,
  onClose,
  ...props
}: DialogContentProps) {
  const [mounted, setMounted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    // Trigger animation after mount
    requestAnimationFrame(() => setIsVisible(true));

    // Prevent body scroll when dialog is open
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Handle click outside
  const handleOverlayClick = useCallback(
    (e: MouseEvent) => {
      if (e.target === e.currentTarget && onClose) {
        onClose();
      }
    },
    [onClose],
  );

  if (!mounted) return null;

  return createPortal(
    <div data-slot="dialog-portal">
      {/* Overlay */}
      <div
        data-slot="dialog-overlay"
        className={cn(
          "fixed inset-0 z-50 bg-black/50 transition-opacity duration-200",
          isVisible ? "opacity-100" : "opacity-0",
        )}
        onClick={handleOverlayClick}
      />
      {
        /*
        Centering wrapper — uses flex instead of top/left+translate because
        combining translate utilities with the `scale-95` enter animation
        conflicts on the `transform` property (Tailwind 4 doesn't compose
        them cleanly when arbitrary values are involved), which caused the
        dialog to render at the bottom of the viewport in some states.
        This wrapper ignores pointer events so the overlay stays clickable.
      */
      }
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Content */}
        <div
          ref={contentRef}
          data-slot="dialog-content"
          role="dialog"
          aria-modal="true"
          className={cn(
            "pointer-events-auto bg-background grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-lg border p-6 shadow-lg transition-[opacity,transform] duration-200 sm:max-w-lg",
            isVisible ? "opacity-100 scale-100" : "opacity-0 scale-95",
            className,
          )}
          {...props}
        >
          {children}
          <button
            type="button"
            onClick={onClose}
            className="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <X />
            <span className="sr-only">Close</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: ComponentProps<"h2">) {
  return (
    <h2
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function DialogClose({
  onClick,
  children,
  ...props
}: ComponentProps<"button">) {
  return (
    <button data-slot="dialog-close" onClick={onClick} {...props}>
      {children}
    </button>
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};

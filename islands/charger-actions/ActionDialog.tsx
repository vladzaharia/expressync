/**
 * ActionDialog — standardised wrapper around the shadcn Dialog used by every
 * per-action dialog in this folder.
 *
 * Headers render the op icon inline-left of the DialogTitle (per the Wave
 * B4 design) rather than stacked above it. Errors show inline in the dialog
 * body rather than via toast so the operator always sees the failure in
 * the context of the form they just submitted.
 *
 * Destructive variants default focus to Cancel — see `ConfirmDialog` for
 * the canonical pattern; we mirror it here.
 */

import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { LucideIcon } from "lucide-preact";
import { Loader2 } from "lucide-preact";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";

export interface ActionDialogProps {
  title: string;
  icon: LucideIcon;
  description?: ComponentChildren;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
  errorText?: string | null;
  confirmLabel?: string;
  confirmVariant?: "default" | "destructive";
  confirmDisabled?: boolean;
  children?: ComponentChildren;
}

export function ActionDialog(
  {
    title,
    icon: Icon,
    description,
    isOpen,
    onClose,
    onConfirm,
    isLoading = false,
    errorText,
    confirmLabel = "Confirm",
    confirmVariant = "default",
    confirmDisabled = false,
    children,
  }: ActionDialogProps,
) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => {
      if (confirmVariant === "destructive") {
        cancelRef.current?.focus();
      } else {
        confirmRef.current?.focus();
      }
    }, 30);
    return () => clearTimeout(t);
  }, [isOpen, confirmVariant]);

  const handleClose = () => {
    if (isLoading) return;
    onClose();
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (isLoading || confirmDisabled) return;
    await onConfirm();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-xl" onClose={handleClose}>
        <DialogHeader>
          <div class="flex items-center gap-3">
            <Icon class="size-5 text-accent-foreground" aria-hidden="true" />
            <DialogTitle>{title}</DialogTitle>
          </div>
          {description !== undefined && description !== null && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>

        <form onSubmit={handleSubmit} class="flex flex-col gap-4">
          {children}

          {errorText && (
            <div
              role="alert"
              class="rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-300"
            >
              {errorText}
            </div>
          )}

          <DialogFooter>
            <Button
              ref={cancelRef}
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              ref={confirmRef}
              type="submit"
              variant={confirmVariant}
              disabled={isLoading || confirmDisabled}
            >
              {isLoading
                ? (
                  <>
                    <Loader2 class="size-4 animate-spin" aria-hidden="true" />
                    <span>{confirmLabel}</span>
                  </>
                )
                : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ActionDialog;

/**
 * ConfirmDialog — canonical confirmation dialog for destructive and
 * non-destructive actions.
 *
 * Replaces ad-hoc `<Dialog>` usages that repeatedly re-implemented the same
 * "title + description + Cancel/Confirm" pattern.  Built on top of the
 * shadcn-style `<Dialog>` primitives.
 *
 * Behaviors:
 *   - Icon is rendered inline-left of the title.
 *   - For `variant="destructive"`, default focus lands on the Cancel button
 *     (accessible safe default).
 *   - `isLoading` disables both buttons and swaps the confirm label for a
 *     spinner; Esc-to-close is blocked while loading.
 *   - `typeToConfirmPhrase` renders a labeled `<Input>` and gates the
 *     confirm button until the typed value matches exactly.
 *   - `confirmDisabled` is an additional external gate that is OR'd with
 *     the type-to-confirm check.
 */

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
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
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ComponentChildren;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  icon?: ComponentChildren;
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
  typeToConfirmPhrase?: string;
  confirmDisabled?: boolean;
  className?: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  icon,
  onConfirm,
  isLoading = false,
  typeToConfirmPhrase,
  confirmDisabled = false,
  className,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Reset typed phrase whenever the dialog closes so re-opening starts clean.
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  // Focus management: destructive dialogs default focus to Cancel; default
  // variant lands focus on Confirm.  Small timeout lets the Dialog finish
  // mounting + its enter animation before we steal focus.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (variant === "destructive") {
        cancelRef.current?.focus();
      } else {
        confirmRef.current?.focus();
      }
    }, 20);
    return () => clearTimeout(t);
  }, [open, variant]);

  const phraseOk = !typeToConfirmPhrase || typed === typeToConfirmPhrase;
  const confirmIsDisabled = isLoading || confirmDisabled || !phraseOk;

  const handleClose = () => {
    if (isLoading) return;
    onOpenChange(false);
  };

  const handleConfirm = async () => {
    if (confirmIsDisabled) return;
    await onConfirm();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("sm:max-w-md", className)}
        onClose={handleClose}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {icon ? <span className="inline-flex shrink-0">{icon}</span> : null}
            <span>{title}</span>
          </DialogTitle>
          {description !== undefined && description !== null
            ? <DialogDescription>{description}</DialogDescription>
            : null}
        </DialogHeader>

        {typeToConfirmPhrase
          ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm-dialog-phrase">
                Type{" "}
                <code className="font-mono font-semibold">
                  {typeToConfirmPhrase}
                </code>{" "}
                to confirm
              </Label>
              <Input
                id="confirm-dialog-phrase"
                value={typed}
                onInput={(e) =>
                  setTyped((e.currentTarget as HTMLInputElement).value)}
                disabled={isLoading}
                autoComplete="off"
                spellcheck={false}
              />
            </div>
          )
          : null}

        <DialogFooter className="mt-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isLoading}
            autoFocus={variant === "destructive"}
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            variant={variant === "destructive" ? "destructive" : "default"}
            onClick={handleConfirm}
            disabled={confirmIsDisabled}
            autoFocus={variant !== "destructive"}
          >
            {isLoading
              ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>{confirmLabel}</span>
                </>
              )
              : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConfirmDialog;

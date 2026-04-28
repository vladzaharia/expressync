/**
 * Form — single shared chrome primitive for create / edit / multi-step forms.
 *
 * Owns the footer (Back / Skip / primary) and an optional dots indicator for
 * multi-step flows. The inner form (content children) provides the fields
 * and validation; this primitive carries no form state. Submission is
 * triggered by the route, typically by calling an imperative `submit()` on
 * the inner form's ref from `submit.onClick`.
 *
 * Standardized button vocabulary: Back, Skip, Continue, Create, Edit, Save,
 * Cancel. Keep labels short; verbose actions belong in helper text, not
 * buttons.
 */

import type { ComponentChildren } from "preact";
import { Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

export type FormSubmitLabel = "Save" | "Create" | "Edit" | "Continue";

interface FormProps {
  /** Total step count (>= 2 enables the dots indicator). */
  steps?: number;
  /** 1-based active step. Required when `steps` is set. */
  current?: number;

  submit: {
    label: FormSubmitLabel;
    /** Disables the primary button (e.g., invalid form). */
    disabled?: boolean;
    /** Shows a spinner inside the primary button instead of the icon. */
    pending?: boolean;
    onClick: () => void;
  };

  /** Bottom-left "Back" button (ghost, ChevronLeft). Hidden if absent. */
  back?: { onClick: () => void };
  /** Bottom-right outline "Skip" button. Only meaningful with multi-step. */
  skip?: { onClick: () => void };
  /**
   * Bottom-left "Cancel" link (ghost). Used in place of `back` when there
   * is no prior step to return to.
   */
  cancel?: { href: string };

  children: ComponentChildren;
  className?: string;
}

export function Form({
  steps,
  current,
  submit,
  back,
  skip,
  cancel,
  children,
  className,
}: FormProps) {
  const isMultiStep = typeof steps === "number" && steps > 1;
  const PrimaryIcon = submit.label === "Continue" ? ChevronRight : Check;

  return (
    <div class={cn("space-y-6", className)}>
      <div>{children}</div>

      <div class="flex items-center justify-between gap-2 border-t pt-4">
        <div class="flex items-center gap-2">
          {back
            ? (
              <Button
                type="button"
                variant="ghost"
                onClick={back.onClick}
                disabled={submit.pending}
              >
                <ChevronLeft class="mr-1 h-4 w-4" />
                Back
              </Button>
            )
            : cancel
            ? (
              <a
                href={cancel.href}
                class="text-sm text-muted-foreground hover:text-foreground px-2"
              >
                Cancel
              </a>
            )
            : null}
        </div>

        <div class="flex items-center gap-2">
          {isMultiStep && skip
            ? (
              <Button
                type="button"
                variant="outline"
                onClick={skip.onClick}
                disabled={submit.pending}
              >
                Skip
              </Button>
            )
            : null}
          <Button
            type="button"
            onClick={submit.onClick}
            disabled={submit.disabled || submit.pending}
          >
            {submit.pending
              ? <Loader2 class="mr-2 h-4 w-4 animate-spin" />
              : <PrimaryIcon class="mr-1 h-4 w-4" />}
            {submit.label}
          </Button>
        </div>
      </div>

      {isMultiStep
        ? (
          <div
            class="flex items-center justify-center gap-2 pt-1"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={steps}
            aria-valuenow={current}
            aria-label={`Step ${current} of ${steps}`}
          >
            {Array.from({ length: steps }, (_, i) => (
              <span
                key={i}
                class={cn(
                  "size-2 rounded-full transition-colors",
                  current && i + 1 <= current ? "bg-cyan-500" : "bg-muted",
                )}
              />
            ))}
          </div>
        )
        : null}
    </div>
  );
}

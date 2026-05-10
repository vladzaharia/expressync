import { forwardRef } from "preact/compat";
import { cn } from "@/src/lib/utils/cn.ts";

/**
 * Switch — accessible toggle pill matching the shadcn `Switch` API.
 * Single-button implementation (no Radix dependency) — clicking flips
 * `checked` via `onCheckedChange`. Styling mirrors the project's
 * teal-accented chrome so it slots into the device/capability forms
 * alongside other shadcn primitives.
 */
export interface SwitchProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  name?: string;
  "aria-label"?: string;
}

const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      className,
      checked,
      onCheckedChange,
      disabled,
      id,
      name: _name,
      "aria-label": ariaLabel,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        data-state={checked ? "checked" : "unchecked"}
        disabled={disabled}
        id={id}
        ref={ref}
        className={cn(
          "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          checked
            ? "bg-teal-600 dark:bg-teal-500"
            : "bg-muted-foreground/30 dark:bg-muted-foreground/40",
          className,
        )}
        onClick={() => onCheckedChange?.(!checked)}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
    );
  },
);
Switch.displayName = "Switch";

export { Switch };

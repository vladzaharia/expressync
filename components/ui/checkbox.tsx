import { forwardRef } from "preact/compat";
import { cn } from "@/src/lib/utils/cn.ts";
import { Check } from "lucide-preact";

export interface CheckboxProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  name?: string;
}

const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  (
    { className, checked, onCheckedChange, disabled, id, name, ...props },
    ref,
  ) => {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        data-state={checked ? "checked" : "unchecked"}
        disabled={disabled}
        id={id}
        ref={ref}
        className={cn(
          "peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          checked && "bg-primary text-primary-foreground",
          className,
        )}
        onClick={() => onCheckedChange?.(!checked)}
        {...props}
      >
        {checked && (
          <span className="flex items-center justify-center text-current">
            <Check className="h-3 w-3" />
          </span>
        )}
      </button>
    );
  },
);
Checkbox.displayName = "Checkbox";

export { Checkbox };

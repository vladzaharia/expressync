import * as React from "preact/compat";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/src/lib/utils/cn.ts";

const ToggleGroupContext = React.createContext<{
  size?: "default" | "sm" | "lg";
  variant?: "default" | "outline" | "outline-joined";
}>({
  size: "default",
  variant: "default",
});

const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> & {
    variant?: "default" | "outline" | "outline-joined";
    size?: "default" | "sm" | "lg";
  }
>((
  { className, variant = "default", size = "default", children, ...props },
  ref,
) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn(
      "flex items-center justify-center",
      variant === "outline-joined" ? "gap-0" : "gap-1",
      className,
    )}
    {...props}
  >
    <ToggleGroupContext.Provider value={{ variant, size }}>
      {children}
    </ToggleGroupContext.Provider>
  </ToggleGroupPrimitive.Root>
));

ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> & {
    variant?: "default" | "outline" | "outline-joined";
    size?: "default" | "sm" | "lg";
  }
>(({ className, children, variant, size, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext);
  const effectiveVariant = variant ?? context.variant;

  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center text-sm font-medium ring-offset-background transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
        // Default rounded corners
        effectiveVariant !== "outline-joined" && "rounded-md",
        // Default hover (not for outline-joined)
        effectiveVariant !== "outline-joined" &&
          "hover:bg-muted hover:text-muted-foreground",
        // Standard outline variant
        effectiveVariant === "outline" &&
          "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
        // Joined outline variant - connected buttons with shared borders, hover uses accent text
        effectiveVariant === "outline-joined" &&
          "border border-input bg-transparent -ml-px first:ml-0 first:rounded-l-md last:rounded-r-md",
        // Sizes
        {
          "h-10 px-3": (size ?? context.size) === "default",
          "h-9 px-2.5": (size ?? context.size) === "sm",
          "h-11 px-5": (size ?? context.size) === "lg",
        },
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
});

ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { ToggleGroup, ToggleGroupItem };

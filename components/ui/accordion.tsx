import { createContext } from "preact";
import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";
import { cn } from "@/src/lib/utils/cn.ts";
import { ChevronDown } from "lucide-preact";

// Context for accordion state
interface AccordionContextType {
  type: "single" | "multiple";
  openItems: Set<string>;
  toggleItem: (value: string) => void;
}

const AccordionContext = createContext<AccordionContextType | null>(null);

// Context for individual accordion item
interface AccordionItemContextType {
  value: string;
  isOpen: boolean;
}

const AccordionItemContext = createContext<AccordionItemContextType | null>(
  null,
);

// Hook to use accordion context
function useAccordion() {
  const context = useContext(AccordionContext);
  if (!context) throw new Error("useAccordion must be used within Accordion");
  return context;
}

// Hook to use accordion item context
function useAccordionItem() {
  const context = useContext(AccordionItemContext);
  if (!context) {
    throw new Error("useAccordionItem must be used within AccordionItem");
  }
  return context;
}

// Main Accordion component
interface AccordionProps {
  type?: "single" | "multiple";
  defaultValue?: string | string[];
  className?: string;
  children: ComponentChildren;
}

export function Accordion({
  type = "single",
  defaultValue,
  className,
  children,
}: AccordionProps) {
  const [openItems, setOpenItems] = useState<Set<string>>(() => {
    if (!defaultValue) return new Set();
    return new Set(Array.isArray(defaultValue) ? defaultValue : [defaultValue]);
  });

  const toggleItem = useCallback((value: string) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        if (type === "single") {
          next.clear();
        }
        next.add(value);
      }
      return next;
    });
  }, [type]);

  return (
    <AccordionContext.Provider value={{ type, openItems, toggleItem }}>
      <div className={cn("space-y-1", className)}>
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

// Accordion Item wrapper
interface AccordionItemProps {
  value: string;
  className?: string;
  children: ComponentChildren;
}

export function AccordionItem(
  { value, className, children }: AccordionItemProps,
) {
  const { openItems } = useAccordion();
  const isOpen = openItems.has(value);

  return (
    <AccordionItemContext.Provider value={{ value, isOpen }}>
      <div className={cn("border rounded-lg", className)}>
        {children}
      </div>
    </AccordionItemContext.Provider>
  );
}

// Accordion Trigger (header)
interface AccordionTriggerProps {
  className?: string;
  children: ComponentChildren;
}

export function AccordionTrigger(
  { className, children }: AccordionTriggerProps,
) {
  const { toggleItem } = useAccordion();
  const { value, isOpen } = useAccordionItem();

  return (
    <button
      type="button"
      onClick={() => toggleItem(value)}
      className={cn(
        "flex w-full items-center justify-between px-4 py-3 text-sm font-medium transition-all hover:bg-muted/50 cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      aria-expanded={isOpen}
    >
      {children}
      <ChevronDown
        className={cn(
          "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
          isOpen && "rotate-180",
        )}
      />
    </button>
  );
}

// Accordion Content (collapsible panel)
interface AccordionContentProps {
  className?: string;
  children: ComponentChildren;
}

export function AccordionContent(
  { className, children }: AccordionContentProps,
) {
  const { isOpen } = useAccordionItem();
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">(isOpen ? "auto" : 0);

  useEffect(() => {
    if (contentRef.current) {
      setHeight(isOpen ? contentRef.current.scrollHeight : 0);
    }
  }, [isOpen]);

  return (
    <div
      className="overflow-hidden transition-[height] duration-200 ease-out"
      style={{ height: typeof height === "number" ? `${height}px` : height }}
    >
      <div ref={contentRef} className={cn("p-4", className)}>
        {children}
      </div>
    </div>
  );
}

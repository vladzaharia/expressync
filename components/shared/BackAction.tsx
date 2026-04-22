import { ArrowLeft } from "lucide-preact";
import { CHROME_SIZE } from "@/components/AppSidebar.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

interface BackActionProps {
  href: string;
  label?: string;
  className?: string;
}

export function BackAction(
  { href, label = "Back", className }: BackActionProps,
) {
  return (
    <a
      href={href}
      className={cn(
        "flex items-center justify-center gap-2 px-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      style={{ height: CHROME_SIZE }}
    >
      <ArrowLeft className="size-5" />
      <span className="text-sm font-medium">{label}</span>
    </a>
  );
}

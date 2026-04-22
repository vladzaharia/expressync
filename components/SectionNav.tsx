import { findSectionByPath } from "@/src/lib/admin-navigation.ts";
import { BlurFade } from "@/components/magicui/blur-fade.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

interface Props {
  currentPath: string;
  className?: string;
}

/**
 * Top-bar breadcrumb: "SECTION / Item" for the current route.
 *
 * Sources from `NAV_SECTIONS` via `findSectionByPath`, which handles detail
 * routes (e.g. `/chargers/abc123`) by prefix-matching the parent nav path.
 * Renders an empty spacer when the route is not represented in NAV_SECTIONS.
 */
export function SectionNav({ currentPath, className }: Props) {
  const match = findSectionByPath(currentPath);
  if (!match) {
    return <div class={cn("flex items-center px-4", className)} />;
  }
  const { section, item } = match;
  return (
    <BlurFade
      direction="right"
      duration={0.3}
      className={cn("flex items-center gap-2 px-4 min-w-0", className)}
    >
      <span class="text-xs text-muted-foreground uppercase tracking-wide whitespace-nowrap">
        {section.title}
      </span>
      <span class="text-xs text-muted-foreground">/</span>
      <span class="text-sm font-medium truncate">{item.title}</span>
    </BlurFade>
  );
}

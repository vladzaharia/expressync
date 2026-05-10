import type { ComponentChildren } from "preact";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { GridPattern } from "@/components/magicui/grid-pattern.tsx";
import { BorderBeam } from "@/components/magicui/border-beam.tsx";
import { BlurFade } from "@/components/magicui/blur-fade.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { type AccentColor, borderBeamColors } from "@/src/lib/colors.ts";

export type PageCardColorScheme = AccentColor;

interface PageCardProps {
  title?: string;
  description?: string;
  children: ComponentChildren;
  colorScheme?: PageCardColorScheme;
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  /**
   * Applied to PageCard's outermost wrapper (and the BlurFade root when
   * animation is enabled). Use `flex h-full min-h-0 flex-col` to let the
   * card fill a height-locked parent without scrolling the page.
   */
  outerClassName?: string;
  /** Applied to the inner shadcn `<Card>` element. Use to make the card
   * fill its wrapper (e.g. `flex h-full flex-col`). */
  cardClassName?: string;
  showGridPattern?: boolean;
  headerActions?: ComponentChildren;
  /**
   * Floating accessory pinned to the card's top-right corner, above the
   * BorderBeam. Used for the public-ID watermark + QR popover on charger
   * and user detail pages — a one-per-page identity affordance per
   * CLAUDE.md's "one PageCard per page" rule.
   */
  topRightAccessory?: ComponentChildren;
  /** Animation delay in seconds */
  animationDelay?: number;
  /** Disable blur fade animation */
  disableAnimation?: boolean;
}

/**
 * A reusable page card component with BorderBeam effect
 * Provides consistent styling across the application
 */
export function PageCard({
  title,
  description,
  children,
  colorScheme = "blue",
  className,
  headerClassName,
  contentClassName,
  outerClassName,
  cardClassName,
  showGridPattern = true,
  headerActions,
  topRightAccessory,
  animationDelay = 0,
  disableAnimation = false,
}: PageCardProps) {
  const colors = borderBeamColors[colorScheme];

  const content = (
    <div className={cn("relative", outerClassName)}>
      {showGridPattern && (
        <GridPattern
          width={30}
          height={30}
          className="absolute inset-0 -z-10 opacity-[0.015] [mask-image:linear-gradient(to_bottom,white_20%,transparent_80%)]"
          squares={[[1, 1], [3, 2], [5, 4], [7, 3], [9, 1]]}
        />
      )}

      <div className={cn("relative overflow-hidden rounded-xl", className)}>
        <Card className={cardClassName}>
          {(title || description || headerActions) && (
            <CardHeader
              className={cn(
                "border-b border-border/50",
                // Reserve vertical room + right padding when the
                // top-right accessory is mounted (e.g.
                // PublicIdQrPopover renders a 2-row stack ~48px tall
                // that would otherwise overlap the body content).
                topRightAccessory && "min-h-[5rem] pr-20",
                headerClassName,
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  {title && (
                    <CardTitle className="break-words">{title}</CardTitle>
                  )}
                  {description && (
                    <CardDescription>{description}</CardDescription>
                  )}
                </div>
                {headerActions && (
                  <div className="flex items-center gap-2 shrink-0">
                    {headerActions}
                  </div>
                )}
              </div>
            </CardHeader>
          )}
          <CardContent className={contentClassName}>{children}</CardContent>
        </Card>
        <BorderBeam
          size={200}
          duration={15}
          colorFrom={colors.from}
          colorTo={colors.to}
        />
        {topRightAccessory && (
          <div className="pointer-events-none absolute right-5 top-5 z-10">
            <div className="pointer-events-auto">{topRightAccessory}</div>
          </div>
        )}
      </div>
    </div>
  );

  if (disableAnimation) {
    return content;
  }

  return (
    <BlurFade
      delay={animationDelay}
      duration={0.4}
      direction="up"
      className={outerClassName}
    >
      {content}
    </BlurFade>
  );
}

/**
 * A simpler version without the card header - just content with border beam
 */
export function PageCardSimple({
  children,
  colorScheme = "blue",
  className,
  showGridPattern = false,
  animationDelay = 0,
  disableAnimation = false,
}: Omit<
  PageCardProps,
  | "title"
  | "description"
  | "headerClassName"
  | "contentClassName"
  | "headerActions"
>) {
  const colors = borderBeamColors[colorScheme];

  const content = (
    <div className="relative">
      {showGridPattern && (
        <GridPattern
          width={30}
          height={30}
          className="absolute inset-0 -z-10 opacity-[0.015] [mask-image:linear-gradient(to_bottom,white_20%,transparent_80%)]"
          squares={[[1, 1], [3, 2], [5, 4], [7, 3], [9, 1]]}
        />
      )}

      <div className={cn("relative overflow-hidden rounded-xl", className)}>
        {children}
        <BorderBeam
          size={200}
          duration={15}
          colorFrom={colors.from}
          colorTo={colors.to}
        />
      </div>
    </div>
  );

  if (disableAnimation) {
    return content;
  }

  return (
    <BlurFade delay={animationDelay} duration={0.4} direction="up">
      {content}
    </BlurFade>
  );
}

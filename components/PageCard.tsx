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
  showGridPattern?: boolean;
  headerActions?: ComponentChildren;
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
  showGridPattern = true,
  headerActions,
  animationDelay = 0,
  disableAnimation = false,
}: PageCardProps) {
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
        <Card>
          {(title || description || headerActions) && (
            <CardHeader
              className={cn("border-b border-border/50", headerClassName)}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  {title && <CardTitle>{title}</CardTitle>}
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
  "title" | "description" | "headerClassName" | "contentClassName" | "headerActions"
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


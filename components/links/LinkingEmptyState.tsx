/**
 * LinkingEmptyState — first-run empty state for `/links`.
 *
 * Shown when there are zero mappings. Offers two entry points:
 *   - Primary: "Link a tag" → `/links/new`.
 *   - Secondary: "Register a tag first" → `/tags/new` (no tags registered
 *     yet? start there).
 *
 * Server-rendered.
 */

import { Link2, Tag } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import { Button } from "@/components/ui/button.tsx";
import { BlurFade } from "@/components/magicui/blur-fade.tsx";
import { GridPattern } from "@/components/magicui/grid-pattern.tsx";

interface Props {
  class?: string;
}

export function LinkingEmptyState({ class: className }: Props) {
  return (
    <BlurFade delay={0.05} duration={0.4} direction="up">
      <div
        class={cn(
          "relative overflow-hidden rounded-lg border border-dashed border-violet-500/40 bg-violet-500/5 px-6 py-12 text-center",
          className,
        )}
      >
        <GridPattern
          width={24}
          height={24}
          class="absolute inset-0 -z-10 opacity-[0.04]"
          squares={[[1, 1], [3, 2], [5, 4]]}
        />
        <div class="mx-auto flex size-16 items-center justify-center rounded-2xl bg-violet-500/10">
          <Link2 class="size-8 text-violet-500" aria-hidden="true" />
        </div>
        <h2 class="mt-4 text-lg font-semibold">No tag links yet</h2>
        <p class="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Link an OCPP tag to a Lago customer and subscription to start billing
          for EV charging sessions.
        </p>
        <div class="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            asChild
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            <a href="/links/new">
              <Link2 class="mr-2 size-4" aria-hidden="true" />
              Link a tag
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href="/tags/new">
              <Tag class="mr-2 size-4" aria-hidden="true" />
              Register a tag first
            </a>
          </Button>
        </div>
      </div>
    </BlurFade>
  );
}

/**
 * MobileBottomTabBar — fixed 64px bottom navigation bar for the customer
 * mobile shell. Hidden at `md+` (the desktop sidebar takes over).
 *
 * Five tabs: Dashboard, Sessions, Reserve, Cards, Billing — driven by
 * `getCustomerBottomTabs()` so the source of truth lives in one file.
 *
 * Active state: MD3-style pill (rounded-full + accent wash) behind the
 * icon, label color shifts to the accent. Press feedback:
 * `active:scale-95 transition-transform duration-75`. Background uses
 * `bg-background/85 backdrop-blur-md border-t` so content scrolls
 * underneath without a hard cut-off line.
 *
 * z-index 40 (below ImpersonationBanner z-35 / Dialog z-50; above
 * regular page content). The mobile shell adds `pb-20` to page content
 * so the bar never overlaps the last visible row.
 */

import {
  type CustomerNavItem,
  getCustomerBottomTabs,
  isCustomerPathActive,
} from "@/src/lib/customer-navigation.ts";
import { accentTailwindClasses } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";

interface Props {
  currentPath: string;
}

export function MobileBottomTabBar({ currentPath }: Props) {
  const tabs = getCustomerBottomTabs();
  return (
    <nav
      class={cn(
        "fixed inset-x-0 bottom-0 z-40 md:hidden",
        "border-t bg-background/85 backdrop-blur-md",
        "pb-[env(safe-area-inset-bottom)]",
      )}
      aria-label="Customer primary"
    >
      <ul class="grid h-16 grid-cols-5">
        {tabs.map((tab) => (
          <li key={tab.id} class="contents">
            <BottomTab
              tab={tab}
              active={isCustomerPathActive(tab.path, currentPath)}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function BottomTab(
  { tab, active }: { tab: CustomerNavItem; active: boolean },
) {
  const Icon = tab.icon;
  const tone = tab.accentColor === "primary"
    ? null
    : accentTailwindClasses[tab.accentColor];
  const activeBg = tone ? tone.bg : "bg-primary/15";
  const activeText = tone ? tone.text : "text-primary";

  return (
    <a
      href={tab.path}
      aria-label={tab.title}
      aria-current={active ? "page" : undefined}
      class={cn(
        "flex h-full min-h-11 flex-col items-center justify-center gap-0.5",
        "transition-transform duration-75 active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
    >
      <span
        class={cn(
          "flex size-7 items-center justify-center rounded-full transition-colors",
          active ? cn(activeBg, activeText) : "text-muted-foreground",
        )}
      >
        <Icon
          class="size-4"
          fill={active ? "currentColor" : "none"}
          aria-hidden="true"
        />
      </span>
      <span
        class={cn(
          "text-[11px] leading-none font-medium",
          active ? activeText : "text-muted-foreground",
        )}
      >
        {tab.title}
      </span>
    </a>
  );
}

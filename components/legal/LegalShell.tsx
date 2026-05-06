/**
 * Public-facing shell for the Privacy Policy / Terms of Service routes.
 *
 * No sidebar, no auth dependency. The pages are reachable by anyone — App
 * Store / search engines / unauth'd customers — so the chrome must stand
 * up without a `state.user`. Keeps the same brand language as the login
 * route (PolarisExpressBrand, dark gradient backdrop) so the page reads
 * as part of the same product, not an HTML dump.
 */

import type { ComponentChildren } from "preact";
import { PolarisExpressBrand } from "@/components/brand/PolarisExpressBrand.tsx";
import { GridPattern } from "@/components/magicui/grid-pattern.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

interface Props {
  /** Document title — "Privacy Policy" or "Terms of Service". */
  title: string;
  /** Optional short tagline shown beneath the title. */
  description?: string;
  /** Active page key — drives the underline on the nav links. */
  active: "privacy" | "terms";
  children: ComponentChildren;
}

export function LegalShell(
  { title, description, active, children }: Props,
) {
  return (
    <div class="relative min-h-dvh bg-background">
      <GridPattern
        width={40}
        height={40}
        className="absolute inset-0 -z-10 opacity-[0.06]"
        squares={[[1, 1], [3, 3], [5, 2], [2, 5], [7, 4], [4, 7], [6, 1], [
          8,
          6,
        ]]}
      />
      <div class="absolute inset-0 -z-10 bg-gradient-to-b from-background via-background to-primary/5" />

      {/* Header */}
      <header class="border-b bg-background/80 backdrop-blur-sm">
        <div class="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <a href="/" class="flex items-center gap-2 no-underline">
            <PolarisExpressBrand variant="header-mobile" />
          </a>
          <nav class="flex items-center gap-1 text-sm">
            <LegalNavLink href="/privacy" label="Privacy" current={active === "privacy"} />
            <LegalNavLink href="/terms" label="Terms" current={active === "terms"} />
          </nav>
        </div>
      </header>

      {/* Main */}
      <main class="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <div class="mb-8">
          <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">
            {title}
          </h1>
          {description
            ? (
              <p class="mt-2 text-base text-muted-foreground">{description}</p>
            )
            : null}
        </div>
        {children}
      </main>

      {/* Footer */}
      <footer class="border-t">
        <div class="mx-auto flex max-w-3xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <span>© Polaris Express</span>
          <nav class="flex items-center gap-4">
            <a class="hover:text-foreground" href="/privacy">Privacy</a>
            <a class="hover:text-foreground" href="/terms">Terms</a>
            <a class="hover:text-foreground" href="/login">Sign in</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function LegalNavLink(
  { href, label, current }: { href: string; label: string; current: boolean },
) {
  return (
    <a
      href={href}
      aria-current={current ? "page" : undefined}
      class={cn(
        "rounded-md px-3 py-1.5 transition-colors",
        current
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
    </a>
  );
}

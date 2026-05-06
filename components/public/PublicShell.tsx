/**
 * Brand chrome for public, unauth'd pages.
 *
 * Extracted from `LegalShell` so the legal pages and the charger landing
 * page share one chrome — same dark gradient backdrop, same brand
 * lockup, same footer. Each page provides its own header nav (or none)
 * and its own main content; this component only owns the surrounding
 * layout.
 */

import type { ComponentChildren } from "preact";
import { PolarisExpressBrand } from "@/components/brand/PolarisExpressBrand.tsx";
import { GridPattern } from "@/components/magicui/grid-pattern.tsx";

export interface FooterLink {
  href: string;
  label: string;
}

interface Props {
  /** Slot for the right-aligned header nav (e.g. legal page tabs). */
  headerNav?: ComponentChildren;
  /** Footer link list — defaults to Privacy / Terms / Sign in. */
  footerLinks?: readonly FooterLink[];
  /** Page body. */
  children: ComponentChildren;
}

const DEFAULT_FOOTER_LINKS: readonly FooterLink[] = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/login", label: "Sign in" },
];

export function PublicShell(
  { headerNav, footerLinks, children }: Props,
) {
  const links = footerLinks ?? DEFAULT_FOOTER_LINKS;
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

      <header class="border-b bg-background/80 backdrop-blur-sm">
        <div class="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <a href="/" class="flex items-center gap-2 no-underline">
            <PolarisExpressBrand variant="header-mobile" />
          </a>
          {headerNav
            ? <nav class="flex items-center gap-1 text-sm">{headerNav}</nav>
            : null}
        </div>
      </header>

      <main class="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        {children}
      </main>

      <footer class="border-t">
        <div class="mx-auto flex max-w-3xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <span>© Polaris Express</span>
          <nav class="flex items-center gap-4">
            {links.map((l) => (
              <a class="hover:text-foreground" href={l.href}>{l.label}</a>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}

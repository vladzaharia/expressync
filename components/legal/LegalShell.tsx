/**
 * Public-facing shell for the Privacy Policy / Terms of Service routes.
 *
 * Wraps `PublicShell` (the shared brand chrome) with the legal nav tabs
 * and the page heading. Auth-free — the App Store / Apple Developer
 * portal links land here without a session.
 */

import type { ComponentChildren } from "preact";
import { PublicShell } from "@/components/public/PublicShell.tsx";
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
    <PublicShell
      headerNav={
        <>
          <LegalNavLink
            href="/privacy"
            label="Privacy"
            current={active === "privacy"}
          />
          <LegalNavLink
            href="/terms"
            label="Terms"
            current={active === "terms"}
          />
        </>
      }
    >
      <div class="mb-8">
        <h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h1>
        {description
          ? <p class="mt-2 text-base text-muted-foreground">{description}</p>
          : null}
      </div>
      {children}
    </PublicShell>
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

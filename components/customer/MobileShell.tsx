/**
 * MobileShell — wraps customer pages with the mobile-only chrome:
 *
 *   ImpersonationBanner    (only when ctx.state.actingAs is set)
 *   ActiveSessionBanner    (only when an active session exists)
 *   PolarisExpressBrand    (header-mobile, only on root)
 *   {children}             (page content; padded for the bottom-tab)
 *   MobileBottomTabBar     (fixed bottom — owned here so it renders
 *                           regardless of which page is showing)
 *
 * NOTE on integration: this component is rendered conditionally from
 * `SidebarLayout` when `role="customer"` AND we're on a mobile viewport.
 * The desktop customer surface uses the existing `SidebarWrapper` with
 * the customer nav passed in. Splitting mobile / desktop at the layout
 * layer keeps each pathway simple.
 */

import type { ComponentChildren } from "preact";
import { PolarisExpressBrand } from "@/components/brand/PolarisExpressBrand.tsx";
import { MobileBottomTabBar } from "@/components/customer/MobileBottomTabBar.tsx";
import ImpersonationBanner from "@/islands/customer/ImpersonationBanner.tsx";
import ActiveSessionBanner from "@/islands/customer/ActiveSessionBanner.tsx";
import { BackAction } from "@/components/shared/BackAction.tsx";
import UserAvatarMenu from "@/components/UserAvatarMenu.tsx";

interface User {
  id: string;
  name: string | null | undefined;
  email: string;
  image?: string | null | undefined;
  role?: string | null | undefined;
}

interface ImpersonationCtx {
  customerName: string;
  customerEmail: string;
  redirectTo?: string;
}

export interface MobileShellProps {
  children: ComponentChildren;
  currentPath: string;
  user?: User;
  impersonation?: ImpersonationCtx | null;
  activeSession?: {
    steveTransactionId: number;
    chargeBoxId: string | null;
    connectorType?: string | null;
    connectorId?: number | null;
    powerKw?: number;
    kwh: number;
    startedAt: string | null;
    estimatedCost?: number;
    currencySymbol?: string;
  } | null;
  /** Optional page title shown in the mobile top bar (deeper pages). */
  pageTitle?: string;
  /** href to back-link to from the mobile top bar (deeper pages). */
  backHref?: string;
}

export function MobileShell({
  children,
  currentPath,
  user,
  impersonation,
  activeSession,
  pageTitle,
  backHref,
}: MobileShellProps) {
  const isRoot = currentPath === "/";

  return (
    <div class="flex min-h-screen flex-col bg-background">
      {impersonation && (
        <ImpersonationBanner
          customerName={impersonation.customerName}
          customerEmail={impersonation.customerEmail}
          redirectTo={impersonation.redirectTo ?? "/admin"}
        />
      )}

      <ActiveSessionBanner initial={activeSession ?? null} />

      {/* Top bar */}
      <header
        class="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b bg-background/85 px-3 backdrop-blur-md"
        role="banner"
      >
        {!isRoot && backHref
          ? (
            <BackAction
              href={backHref}
              label={pageTitle ?? "Back"}
              className="px-0"
            />
          )
          : <PolarisExpressBrand variant="header-mobile" />}
        <div class="flex-1" />
        <UserAvatarMenu user={user} />
      </header>

      <main id="main-content" class="flex-1 overflow-auto p-4 pb-20">
        {children}
      </main>

      <MobileBottomTabBar currentPath={currentPath} />
    </div>
  );
}

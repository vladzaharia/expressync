/**
 * CustomerLoginWizard — orchestrates the two customer sign-in methods.
 *
 * Step flow:
 *   1. "choose"  — two big square buttons: Scan Card / Email Link
 *   2a. "scan"   — inline scan flow (CustomerScanLoginIsland with inline)
 *   2b. "email"  — the magic-link form
 *
 * When only one method is enabled server-side, step 1 is skipped and the
 * user lands directly on the available step. A "Back" button on step 2
 * only renders when both methods are available (otherwise there's nowhere
 * to go back to).
 */

import { useSignal } from "@preact/signals";
import { ChevronLeft, IdCard, Mail } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import CustomerScanLoginIsland from "@/islands/customer/CustomerScanLoginIsland.tsx";
import CustomerLoginForm from "@/islands/customer/CustomerLoginForm.tsx";

type Step = "choose" | "scan" | "email";

interface Props {
  scanEnabled: boolean;
  emailEnabled: boolean;
  autoOpenScan?: boolean;
  initialChargeBoxId?: string | null;
  defaultEmail?: string;
}

function initialStep(
  scan: boolean,
  email: boolean,
  autoOpenScan?: boolean,
): Step {
  if (autoOpenScan && scan) return "scan";
  if (scan && !email) return "scan";
  if (email && !scan) return "email";
  return "choose";
}

export default function CustomerLoginWizard(
  {
    scanEnabled,
    emailEnabled,
    autoOpenScan = false,
    initialChargeBoxId = null,
    defaultEmail = "",
  }: Props,
) {
  const step = useSignal<Step>(
    initialStep(scanEnabled, emailEnabled, autoOpenScan),
  );
  const bothAvailable = scanEnabled && emailEnabled;

  if (step.value === "choose") {
    return (
      <div class="space-y-4">
        <p class="text-xs uppercase tracking-wide text-muted-foreground text-center">
          Choose how to sign in
        </p>
        <div class="grid grid-cols-2 gap-3">
          <MethodButton
            icon={<IdCard class="size-10" aria-hidden="true" />}
            label="Scan Card"
            disabled={!scanEnabled}
            onClick={() => (step.value = "scan")}
          />
          <MethodButton
            icon={<Mail class="size-10" aria-hidden="true" />}
            label="Email Link"
            disabled={!emailEnabled}
            onClick={() => (step.value = "email")}
          />
        </div>
      </div>
    );
  }

  const backPill = bothAvailable
    ? (
      <BackPill
        onClick={() => {
          // Fire the release-signal synchronously so the scan island's
          // listener runs BEFORE we trigger its unmount by flipping step.
          // Without this, the wizard's tab-close / back-click races the
          // DELETE fetch and the charger stays armed.
          if (step.value === "scan" && typeof globalThis !== "undefined") {
            globalThis.dispatchEvent(new Event("scan:release"));
          }
          step.value = "choose";
        }}
      />
    )
    : null;

  if (step.value === "scan") {
    return (
      <>
        {backPill}
        <CustomerScanLoginIsland
          inline
          initialChargeBoxId={initialChargeBoxId}
          onExit={bothAvailable ? () => (step.value = "choose") : undefined}
        />
      </>
    );
  }

  // email
  return (
    <>
      {backPill}
      <CustomerLoginForm defaultEmail={defaultEmail} />
    </>
  );
}

/**
 * Pill anchored to the top-left edge of the login card — mirrors the
 * "Admin login →" pill on the opposite corner. Rendered inside the card
 * but positioned absolute; binds to `ShineBorder` which is the nearest
 * position-relative ancestor, so the pill visually sits on the card's
 * top border.
 */
function BackPill({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={cn(
        "absolute left-4 top-0 z-20 -translate-y-1/2 inline-flex items-center gap-1",
        "rounded-full border border-slate-500/40 bg-background px-3 py-1",
        "text-xs font-medium text-slate-600 shadow-sm transition-colors",
        "hover:bg-muted hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      aria-label="Back to sign-in options"
    >
      <ChevronLeft class="size-3.5" aria-hidden="true" />
      Back
    </button>
  );
}

function MethodButton(
  { icon, label, disabled, onClick }: {
    icon: preact.JSX.Element;
    label: string;
    disabled: boolean;
    onClick: () => void;
  },
) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled}
      class={cn(
        "group relative flex aspect-square flex-col items-center justify-center gap-3 rounded-xl border p-4 text-center transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled
          ? "cursor-not-allowed bg-muted/30 text-muted-foreground opacity-60"
          : "bg-card text-primary hover:border-primary/60 hover:bg-primary/5 active:scale-[0.98]",
      )}
    >
      {icon}
      <span class="text-base font-semibold text-foreground">
        {disabled ? `${label} (unavailable)` : label}
      </span>
    </button>
  );
}

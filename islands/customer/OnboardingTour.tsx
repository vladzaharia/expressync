/**
 * OnboardingTour — fullscreen 4-step tour shown to first-run customers.
 *
 * Polaris Track G3 — overlay shown when `users.onboarded_at IS NULL`.
 * Steps:
 *   1. Welcome (centered card)
 *   2. Highlight `[data-tour="hero"]` — live charging status
 *   3. Highlight `[data-tour="reserve"]` — book a charger
 *   4. Highlight `[data-tour="cards"]` — tap your card
 *
 * Implementation notes:
 *   - For MVP we skip the spotlight cutout (clip-path) and just render a
 *     centered card with arrow text pointing at the relevant nav item.
 *     Backdrop is `bg-background/80 backdrop-blur-sm`.
 *   - Each step uses BlurFade for entrance.
 *   - Skip and Got it both POST `/api/customer/onboarded` and dismiss.
 *   - Failure to reach the API is non-fatal — `localStorage.polaris.onboarded`
 *     is set unconditionally so the tour never replays even if the network
 *     is down.
 *   - Bail on `< 320px` viewport (silently mark onboarded).
 *   - Mounts only when `props.isFirstRun=true` is passed by the dashboard.
 */

import { useEffect, useState } from "preact/hooks";
import { ArrowRight, ChevronRight, X } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { BlurFade } from "@/components/magicui/blur-fade.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

interface Props {
  /** Set by the dashboard loader when `users.onboarded_at IS NULL`. */
  isFirstRun: boolean;
}

const LOCAL_STORAGE_KEY = "polaris.onboarded";

const STEPS = [
  {
    title: "Welcome to ExpressCharge",
    body:
      "Your account is ready. Let's quickly walk through what you can do here.",
  },
  {
    title: "Live charging status",
    body:
      "This card shows what's happening at your charger right now — including any active session.",
    targetSelector: '[data-tour="hero"]',
  },
  {
    title: "Reserve a charger",
    body:
      "Headed out tomorrow morning? Book a window so the charger is ready when you arrive.",
    targetSelector: '[data-tour="reserve"]',
  },
  {
    title: "Tap your card",
    body:
      "Tap a linked card on any ExpressCharge charger to start. Your sessions and invoices land here automatically.",
    targetSelector: '[data-tour="cards"]',
  },
] as const;

async function postOnboarded(): Promise<void> {
  try {
    await fetch("/api/customer/onboarded", { method: "POST" });
  } catch {
    // Non-fatal — local storage gate is the source of truth for
    // dismissal even when the API is unavailable.
  }
}

export default function OnboardingTour({ isFirstRun }: Props) {
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isFirstRun) return;

    // Dismiss silently on tiny viewports (<320px wide). The user can revisit
    // the tour later via /account → Help (TBD).
    if (
      typeof globalThis.innerWidth === "number" && globalThis.innerWidth < 320
    ) {
      void postOnboarded();
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, "1");
      } catch {
        // ignore
      }
      return;
    }

    // Defeat replay if the API misses the first POST: localStorage gate.
    try {
      if (localStorage.getItem(LOCAL_STORAGE_KEY) === "1") return;
    } catch {
      // ignore — fall through and show
    }

    setOpen(true);
  }, [isFirstRun]);

  if (!open) return null;

  const isLastStep = step === STEPS.length - 1;

  const dismiss = async () => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setOpen(false);
    await postOnboarded();
  };

  const next = () => {
    if (isLastStep) {
      void dismiss();
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const current = STEPS[step];

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <BlurFade key={`step-${step}`} duration={0.35} direction="up">
        <div
          class={cn(
            "relative max-w-md w-[min(90vw,28rem)] mx-4",
            "rounded-2xl border bg-card p-6 shadow-2xl",
          )}
        >
          <button
            type="button"
            onClick={dismiss}
            aria-label="Skip tour"
            class="absolute top-3 right-3 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X class="size-4" aria-hidden="true" />
          </button>

          <div
            class="mb-4 flex items-center gap-1.5"
            aria-label={`Step ${step + 1} of ${STEPS.length}`}
          >
            {STEPS.map((_, idx) => (
              <span
                key={idx}
                class={cn(
                  "h-1.5 rounded-full transition-all",
                  idx === step
                    ? "w-8 bg-primary"
                    : idx < step
                    ? "w-4 bg-primary/40"
                    : "w-4 bg-muted",
                )}
              />
            ))}
          </div>

          <h2
            id="onboarding-title"
            class="text-xl font-semibold leading-tight"
          >
            {current.title}
          </h2>
          <p class="mt-2 text-sm text-muted-foreground">
            {current.body}
          </p>

          {"targetSelector" in current && current.targetSelector && (
            <p class="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1 text-xs text-primary">
              <ChevronRight class="size-3" aria-hidden="true" />
              Look for it on this screen
            </p>
          )}

          <div class="mt-6 flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="mobile"
              onClick={() => void dismiss()}
            >
              Skip
            </Button>
            <Button
              type="button"
              size="mobile"
              onClick={next}
            >
              {isLastStep ? "Got it" : (
                <>
                  Next
                  <ArrowRight class="size-4" aria-hidden="true" />
                </>
              )}
            </Button>
          </div>
        </div>
      </BlurFade>
    </div>
  );
}

/**
 * InactiveAccountHero — degraded-state hero rendered in place of the
 * active-charging blocks when the customer has no active mappings.
 *
 * Visual intent: calm, gray, no BorderBeam — the absence of "live" cues
 * tells the user there's nothing to interact with right now. Single CTA:
 * mailto the operator for help.
 *
 * Per copy guideline (lifecycle section of the plan): never use
 * "BLOCKED"/"FORBIDDEN"/"DENIED". Friendly, not punitive.
 */

import { Mail, Pause } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";

interface Props {
  operatorEmail?: string;
  /** Optional secondary copy block, e.g. "Your last session was 2h ago." */
  caption?: string;
}

export default function InactiveAccountHero(
  { operatorEmail, caption }: Props,
) {
  const mailto = operatorEmail
    ? `mailto:${operatorEmail}?subject=${
      encodeURIComponent("ExpressCharge — account access")
    }`
    : "mailto:";

  return (
    <div class="rounded-xl border border-muted-foreground/30 bg-card px-6 py-10 text-center">
      <div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
        <Pause class="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <h2 class="text-xl font-semibold">
        Your account is currently inactive.
      </h2>
      <p class="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
        You can review your previous sessions and invoices. To start charging
        again, please contact your operator.
      </p>
      {caption && <p class="mt-2 text-xs text-muted-foreground">{caption}</p>}
      <div class="mt-6">
        <Button asChild size="mobile">
          <a href={mailto} aria-label="Email your operator">
            <Mail class="size-4" />
            <span>Contact operator</span>
          </a>
        </Button>
      </div>
    </div>
  );
}

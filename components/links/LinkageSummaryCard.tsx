/**
 * LinkageSummaryCard — aside panel on `/links/[id]` that recaps who the
 * tag bills and surfaces jump-off links to related surfaces.
 *
 * Redesign (Wave E follow-up): replace the prose paragraph + four stacked
 * buttons with a compact key/value table (the "who" question) and a tight
 * icon-button row (the "where do I go" question). This reads in a glance
 * even at 360px wide and stops the aside from feeling like a dialog.
 */

import {
  CreditCard,
  ExternalLink,
  Link2,
  Scan,
  Tag,
  User,
} from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { SectionCard } from "@/components/shared/SectionCard.tsx";
import { PlanBadge } from "@/components/shared/PlanBadge.tsx";

interface Props {
  idTag: string;
  tagPk: number;
  customer: null | {
    externalId: string;
    name: string;
    lagoUrl?: string | null;
  };
  subscription: null | {
    externalId: string;
    name: string;
    lagoUrl?: string | null;
  };
}

export function LinkageSummaryCard(
  { idTag, tagPk, customer, subscription }: Props,
) {
  return (
    <SectionCard title="Link summary" icon={Link2} accent="violet">
      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
        <dt class="text-xs uppercase tracking-wide text-muted-foreground pt-0.5">
          Tag
        </dt>
        <dd class="font-mono text-sm truncate">{idTag}</dd>

        <dt class="text-xs uppercase tracking-wide text-muted-foreground pt-0.5">
          Customer
        </dt>
        <dd class="truncate">
          {customer
            ? <span class="font-medium">{customer.name}</span>
            : <span class="text-muted-foreground italic">Not linked</span>}
        </dd>

        <dt class="text-xs uppercase tracking-wide text-muted-foreground pt-0.5">
          Plan
        </dt>
        <dd class="truncate">
          {subscription
            ? (
              <PlanBadge
                name={subscription.name}
                planCode={subscription.externalId}
                size="sm"
              />
            )
            : <PlanBadge name={null} size="sm" />}
        </dd>
      </dl>

      <div class="mt-4 flex flex-col gap-2 border-t pt-4">
        <Button variant="outline" size="sm" asChild>
          <a href={`/tags/${tagPk}`}>
            <Tag class="mr-2 size-4" aria-hidden="true" />
            Edit tag metadata
          </a>
        </Button>
        {customer && (
          <Button variant="outline" size="sm" asChild>
            <a
              href={`/links/new?customerId=${
                encodeURIComponent(customer.externalId)
              }`}
            >
              <Scan class="mr-2 size-4" aria-hidden="true" />
              Scan another tag
            </a>
          </Button>
        )}
        {customer?.lagoUrl && (
          <Button variant="ghost" size="sm" asChild>
            <a
              href={customer.lagoUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <User class="mr-2 size-4" aria-hidden="true" />
              Customer in Lago
              <ExternalLink
                class="ml-auto size-3 opacity-60"
                aria-hidden="true"
              />
              <span class="sr-only">(opens in new tab)</span>
            </a>
          </Button>
        )}
        {subscription?.lagoUrl && (
          <Button variant="ghost" size="sm" asChild>
            <a
              href={subscription.lagoUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <CreditCard class="mr-2 size-4" aria-hidden="true" />
              Plan in Lago
              <ExternalLink
                class="ml-auto size-3 opacity-60"
                aria-hidden="true"
              />
              <span class="sr-only">(opens in new tab)</span>
            </a>
          </Button>
        )}
      </div>
    </SectionCard>
  );
}

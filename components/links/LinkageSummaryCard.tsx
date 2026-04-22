/**
 * LinkageSummaryCard — aside panel on `/links/[id]` that recaps the linkage
 * in plain English and offers navigation to related surfaces.
 *
 * Server-rendered. Purely read-only: all mutation happens in the main form
 * or the danger zone.
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
    <SectionCard
      title="Linkage summary"
      icon={Link2}
      accent="violet"
      contentClassName="pt-4 space-y-4 text-sm"
    >
      <p class="text-muted-foreground leading-relaxed">
        Tag <code class="font-mono text-foreground">{idTag}</code> bills{" "}
        <strong class="text-foreground">
          {customer ? customer.name : "—"}
        </strong>
        {subscription
          ? (
            <>
              {" "}on plan{" "}
              <strong class="text-foreground">{subscription.name}</strong>.
            </>
          )
          : <>(no active subscription yet).</>}
      </p>

      <div class="flex flex-col gap-2">
        <Button variant="outline" size="sm" asChild>
          <a href={`/tags/${tagPk}`}>
            <Tag class="mr-2 size-4" aria-hidden="true" />
            Edit tag metadata
          </a>
        </Button>
        {customer?.lagoUrl && (
          <Button variant="outline" size="sm" asChild>
            <a
              href={customer.lagoUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <User class="mr-2 size-4" aria-hidden="true" />
              Open customer in Lago
              <ExternalLink
                class="ml-auto size-3 opacity-60"
                aria-hidden="true"
              />
              <span class="sr-only">(opens in new tab)</span>
            </a>
          </Button>
        )}
        {subscription?.lagoUrl && (
          <Button variant="outline" size="sm" asChild>
            <a
              href={subscription.lagoUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <CreditCard class="mr-2 size-4" aria-hidden="true" />
              Open subscription in Lago
              <ExternalLink
                class="ml-auto size-3 opacity-60"
                aria-hidden="true"
              />
              <span class="sr-only">(opens in new tab)</span>
            </a>
          </Button>
        )}
        {customer && (
          <Button variant="outline" size="sm" asChild>
            <a
              href={`/links/new?customerId=${
                encodeURIComponent(customer.externalId)
              }`}
            >
              <Scan class="mr-2 size-4" aria-hidden="true" />
              Scan another tag for this customer
            </a>
          </Button>
        )}
      </div>
    </SectionCard>
  );
}

/**
 * `/admin/tags/new` — wizard step 1 (register a tag).
 *
 * After successful create, the wrapper navigates to
 * `/admin/tags/{newTagPk}/link?fromCreate=1` (step 2). Linking is optional;
 * the operator can Skip from step 2 to land on the tag detail page.
 */

import { define } from "../../../utils.ts";
import { SidebarLayout } from "../../../components/SidebarLayout.tsx";
import { PageCard } from "../../../components/PageCard.tsx";
import { BackAction } from "../../../components/shared/BackAction.tsx";
import { loadEnrichedTagRoster } from "../../../src/lib/tag-listing.ts";
import type { ParentCandidate } from "../../../components/tags/ParentTagGrid.tsx";
import TagFormWrapper from "../../../islands/TagFormWrapper.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const prefilledIdTag = ctx.url.searchParams.get("idTag") ?? undefined;
    const { rows } = await loadEnrichedTagRoster();
    const parentCandidates: ParentCandidate[] = rows
      .filter((r) => r.isMeta)
      .map((r): ParentCandidate => ({
        idTag: r.idTag,
        ocppTagPk: r.ocppTagPk,
        tagType: r.tagType,
        displayName: r.displayName,
        isMeta: r.isMeta,
        hasLagoCustomer: r.hasLagoCustomer,
      }));
    return { data: { prefilledIdTag, parentCandidates } };
  },
});

export default define.page<typeof handler>(
  function NewTagPage({ data, url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="cyan"
        actions={<BackAction href="/tags" />}
      >
        <PageCard
          title="New tag"
          description="Register a new OCPP tag in StEvE. After saving, you can optionally link it to a customer."
          colorScheme="cyan"
        >
          <TagFormWrapper
            mode="create"
            initial={{ idTag: data.prefilledIdTag }}
            parentCandidates={data.parentCandidates}
            cancelHref="/tags"
            navigateToLinkOnSuccess
            multiStep={{ steps: 2, current: 1 }}
          />
        </PageCard>
      </SidebarLayout>
    );
  },
);

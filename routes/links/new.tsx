import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import MappingForm from "../../islands/MappingForm.tsx";
import { ArrowLeft } from "lucide-preact";
import { CHROME_SIZE } from "../../components/AppSidebar.tsx";
import { config } from "../../src/lib/config.ts";
import { steveClient } from "../../src/lib/steve-client.ts";
import { lagoClient } from "../../src/lib/lago-client.ts";
import { getAllChildTags, isMetaTag } from "../../src/lib/tag-hierarchy.ts";
import { MetaInheritancePreview } from "../../components/links/MetaInheritancePreview.tsx";

/**
 * Loader shape (LinksNewLoaderData):
 *   preselectedCustomerId — query (?customerId=)
 *   preselectedTagId      — query (?tagPk=) resolved to idTag
 *   preselectedTagPk      — resolved when preselectedTagId is set
 *   lagoDashboardUrl      — config
 *   hasAnyCustomers       — Lago (for zero-state hint)
 *   hasAnyTags            — StEvE (for zero-state hint)
 *   metaChildren          — idTags that inherit, when tag is a meta-tag
 */
export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const customerIdParam = url.searchParams.get("customerId");
    const tagPkParam = url.searchParams.get("tagPk");

    let preselectedTagId: string | null = null;
    let preselectedTagPk: number | null = null;
    let metaChildren: string[] | null = null;

    // Resolve tagPk → idTag via StEvE; if the tag is already linked, redirect
    // to its edit page instead of duplicating a mapping.
    if (tagPkParam) {
      const pk = parseInt(tagPkParam);
      if (!Number.isNaN(pk)) {
        try {
          const allTags = await steveClient.getOcppTags();
          const hit = allTags.find((t) => t.ocppTagPk === pk);
          if (hit) {
            const [existing] = await db
              .select({ id: schema.userMappings.id })
              .from(schema.userMappings)
              .where(eq(schema.userMappings.steveOcppTagPk, pk))
              .limit(1);
            if (existing) {
              return ctx.redirect(`/links/${existing.id}`);
            }
            preselectedTagId = hit.idTag;
            preselectedTagPk = hit.ocppTagPk;
            if (isMetaTag(hit.idTag)) {
              metaChildren = getAllChildTags(hit.idTag, allTags).map(
                (c) => c.idTag,
              );
            }
          }
        } catch (err) {
          console.error("Failed to resolve tagPk:", err);
        }
      }
    }

    let hasAnyCustomers = true;
    try {
      const { customers } = await lagoClient.getCustomers();
      hasAnyCustomers = customers.length > 0;
    } catch (err) {
      console.error("Failed to probe Lago customers:", err);
    }

    let hasAnyTags = true;
    try {
      const tags = await steveClient.getOcppTags();
      hasAnyTags = tags.length > 0;
    } catch (err) {
      console.error("Failed to probe StEvE tags:", err);
    }

    return {
      data: {
        preselectedCustomerId: customerIdParam,
        preselectedTagId,
        preselectedTagPk,
        lagoDashboardUrl: config.LAGO_DASHBOARD_URL || null,
        hasAnyCustomers,
        hasAnyTags,
        metaChildren,
      },
    };
  },
});

function BackAction() {
  return (
    <a
      href="/links"
      className="flex items-center justify-center gap-2 px-4 transition-colors"
      style={{ height: CHROME_SIZE }}
    >
      <ArrowLeft className="size-5" />
      <span className="text-sm font-medium">Back</span>
    </a>
  );
}

export default define.page<typeof handler>(
  function NewTagLinkingPage({ data, url, state }) {
    const meta = data.preselectedTagId
      ? isMetaTag(data.preselectedTagId)
      : false;

    const title = meta ? "Link meta-tag" : "New tag link";
    const description = meta
      ? "Linking a meta-tag propagates the customer + subscription to all child tags at the next sync."
      : "Select an OCPP tag and link it to a Lago customer and subscription. Child tags will automatically inherit the parent's billing configuration.";

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="violet"
        actions={<BackAction />}
      >
        <PageCard
          title={title}
          description={description}
          colorScheme="violet"
        >
          <MappingForm
            preselectedTagId={data.preselectedTagId}
            preselectedTagPk={data.preselectedTagPk}
            preselectedCustomerId={data.preselectedCustomerId}
            lagoDashboardUrl={data.lagoDashboardUrl}
            inheritanceSlot={meta && data.preselectedTagId
              ? (
                <MetaInheritancePreview
                  parentIdTag={data.preselectedTagId}
                  childIdTags={data.metaChildren ?? []}
                />
              )
              : null}
          />
        </PageCard>
      </SidebarLayout>
    );
  },
);

/**
 * `/admin/tags/[tagPk]/link` — link / edit-link surface for a single OCPP tag.
 *
 * Three modes detected from the loader:
 *   - **wizard step 2** (`?fromCreate=1`): rendered with `<Form steps=2
 *     current=2>`, `Skip` button → `/admin/tags/{pk}`, `Back` button →
 *     `/admin/tags/{pk}/edit?next=link`. PageCard title "Link tag".
 *   - **standalone create** (no existing customer link): single-step
 *     `<Form>` with Cancel + Create. PageCard title "Link tag".
 *   - **standalone edit** (existing customer link): single-step `<Form>`
 *     with Cancel + Edit. PageCard title "Edit linking".
 */

import { eq } from "drizzle-orm";
import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import { SidebarLayout } from "../../../../components/SidebarLayout.tsx";
import { PageCard } from "../../../../components/PageCard.tsx";
import { BackAction } from "../../../../components/shared/BackAction.tsx";
import { steveClient } from "../../../../src/lib/steve-client.ts";
import { config } from "../../../../src/lib/config.ts";
import { isMetaTag } from "../../../../src/lib/tag-hierarchy.ts";
import LinkingFormWrapper from "../../../../islands/LinkingFormWrapper.tsx";

interface LoaderTag {
  ocppTagPk: number;
  idTag: string;
  displayName: string | null;
  tagType: string | null;
  isMeta: boolean;
  isActive: boolean;
  parentIdTag: string | null;
}

interface LoaderSeed {
  mappingId: number;
  lagoCustomerExternalId: string | null;
  lagoSubscriptionExternalId: string | null;
}

interface LoaderData {
  tag: LoaderTag;
  seed: LoaderSeed | null;
  mode: "create" | "edit";
  fromCreate: boolean;
  preselectedCustomerId: string | null;
  lagoDashboardUrl: string;
}

export const handler = define.handlers({
  async GET(ctx) {
    const tagPk = parseInt(ctx.params.tagPk);
    if (!Number.isFinite(tagPk)) return ctx.redirect("/tags");

    const fromCreate = ctx.url.searchParams.get("fromCreate") === "1";
    const preselectedCustomerId = ctx.url.searchParams.get("customerId");

    let allTags: Awaited<ReturnType<typeof steveClient.getOcppTags>> = [];
    try {
      allTags = await steveClient.getOcppTags();
    } catch (err) {
      console.error("[tags/[tagPk]/link] StEvE fetch failed:", err);
    }
    const steveTag = allTags.find((t) => t.ocppTagPk === tagPk);

    const [mapping] = await db
      .select()
      .from(schema.userMappings)
      .where(eq(schema.userMappings.steveOcppTagPk, tagPk))
      .limit(1);

    if (!steveTag && !mapping) return ctx.redirect("/tags");

    const idTag = steveTag?.idTag ?? mapping?.steveOcppIdTag ?? "";
    const tag: LoaderTag = {
      ocppTagPk: tagPk,
      idTag,
      displayName: mapping?.displayName ?? null,
      tagType: mapping?.tagType ?? null,
      isMeta: isMetaTag(idTag),
      isActive: mapping?.isActive ?? true,
      parentIdTag: steveTag?.parentIdTag ?? null,
    };

    let seed: LoaderSeed | null = null;
    if (mapping?.lagoCustomerExternalId) {
      seed = {
        mappingId: mapping.id,
        lagoCustomerExternalId: mapping.lagoCustomerExternalId,
        lagoSubscriptionExternalId: mapping.lagoSubscriptionExternalId,
      };
    } else if (mapping) {
      // Customerless mapping — reuse the row id when the user fills in the
      // customer so we don't create a duplicate.
      seed = {
        mappingId: mapping.id,
        lagoCustomerExternalId: null,
        lagoSubscriptionExternalId: null,
      };
    }

    const mode: "create" | "edit" = seed?.lagoCustomerExternalId
      ? "edit"
      : "create";

    return {
      data: {
        tag,
        seed,
        mode,
        fromCreate,
        preselectedCustomerId,
        lagoDashboardUrl: config.LAGO_DASHBOARD_URL ?? "",
      } satisfies LoaderData,
    };
  },
});

export default define.page<typeof handler>(function LinkPage(
  { data, url, state },
) {
  const {
    tag,
    seed,
    mode,
    fromCreate,
    preselectedCustomerId,
    lagoDashboardUrl,
  } = data;
  const title = mode === "edit" ? "Edit linking" : "Link tag";
  const description = mode === "edit"
    ? "Update the customer or subscription billing this tag."
    : "Connect this OCPP tag to a Lago customer and subscription so charging sessions get billed.";

  return (
    <SidebarLayout
      currentPath={url.pathname}
      user={state.user}
      accentColor="cyan"
      actions={<BackAction href={`/tags/${tag.ocppTagPk}`} />}
    >
      <PageCard title={title} description={description} colorScheme="cyan">
        <LinkingFormWrapper
          tag={tag}
          seed={seed}
          mode={mode}
          fromCreate={fromCreate}
          preselectedCustomerId={preselectedCustomerId}
          lagoDashboardUrl={lagoDashboardUrl}
        />
      </PageCard>
    </SidebarLayout>
  );
});

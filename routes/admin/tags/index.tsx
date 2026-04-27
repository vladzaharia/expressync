/**
 * `/tags` — OCPP tag listing page.
 *
 * Loader pattern: fetch the authoritative tag roster from StEvE and
 * left-join on `user_mappings` for display metadata.
 *
 * The URL is the filter source of truth:
 *   ?q=<substring>        — id-tag / display-name substring match
 *   ?linked=1|0           — filter by whether a Lago customer is attached
 *   ?active=1|0           — filter by `isActive`
 *   ?meta=1|0             — filter by the `OCPP-` meta-tag prefix
 *   ?types=a,b,c          — CSV of `TagType` values to include
 */

import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { SidebarLayout } from "../../../components/SidebarLayout.tsx";
import { PageCard } from "../../../components/PageCard.tsx";
import { steveClient } from "../../../src/lib/steve-client.ts";
import { isMetaTag } from "../../../src/lib/tag-hierarchy.ts";
import { isTagType, type TagType } from "../../../src/lib/types/tags.ts";
import TagsFilterBar, {
  type TagsFilterStateSerialized,
  type TriState,
} from "../../../islands/TagsFilterBar.tsx";
import {
  TagsStatStrip,
  type TagsStatStripActive,
  type TagsStatStripTotals,
} from "../../../components/tags/TagsStatStrip.tsx";
import { TagListCard } from "../../../components/tags/TagListCard.tsx";
import { Nfc, Plus } from "lucide-preact";
import { BlurFade } from "../../../components/magicui/blur-fade.tsx";
import { GridPattern } from "../../../components/magicui/grid-pattern.tsx";
import { Card } from "../../../components/ui/card.tsx";
import { Button } from "../../../components/ui/button.tsx";

// ---- Types ------------------------------------------------------------------

interface TagListRow {
  ocppTagPk: number;
  idTag: string;
  parentIdTag: string | null;
  parentTagPk: number | null;
  mappingId: number | null;
  displayName: string | null;
  tagType: TagType | null;
  notes: string | null;
  isActive: boolean;
  hasMapping: boolean;
  hasLagoCustomer: boolean;
  isMeta: boolean;
  childCount: number;
}

interface TagsTotals {
  all: number;
  linked: number;
  unlinked: number;
  meta: number;
  inactive: number;
}

interface TagsFilterState {
  q: string;
  linked: TriState;
  active: TriState;
  meta: TriState;
  types: Set<TagType>;
}

interface TagsIndexData {
  rows: TagListRow[];
  totals: TagsTotals;
  filter: TagsFilterState;
  grouping: "flat";
  steveFetchFailed: boolean;
}

// ---- URL → filter state -----------------------------------------------------

function coerceTriState(value: string | null): TriState {
  if (value === "1" || value === "yes" || value === "true") return "yes";
  if (value === "0" || value === "no" || value === "false") return "no";
  return "any";
}

function parseFilterFromUrl(url: URL): TagsFilterState {
  const sp = url.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const linked = coerceTriState(sp.get("linked"));
  const active = coerceTriState(sp.get("active"));
  const meta = coerceTriState(sp.get("meta"));

  const typesRaw = sp.get("types") ?? "";
  const types = new Set<TagType>();
  for (const t of typesRaw.split(",").map((x) => x.trim()).filter(Boolean)) {
    if (isTagType(t)) types.add(t);
  }

  return { q, linked, active, meta, types };
}

function hasAnyFilter(f: TagsFilterState): boolean {
  return (
    f.q.length > 0 ||
    f.linked !== "any" ||
    f.active !== "any" ||
    f.meta !== "any" ||
    f.types.size > 0
  );
}

function whichStatActive(f: TagsFilterState): TagsStatStripActive {
  if (f.linked === "yes") return "linked";
  if (f.linked === "no") return "unlinked";
  if (f.meta === "yes") return "meta";
  if (f.active === "no") return "inactive";
  if (!hasAnyFilter(f)) return "all";
  return null;
}

// ---- Loader -----------------------------------------------------------------

export const handler = define.handlers({
  async GET(ctx) {
    const filter = parseFilterFromUrl(ctx.url);

    // Fetch StEvE tag roster + our mapping rows in parallel.
    let steveFetchFailed = false;
    const [ocppTags, mappings] = await Promise.all([
      steveClient.getOcppTags().catch((err) => {
        console.error("[tags/index] StEvE fetch failed:", err);
        steveFetchFailed = true;
        return [] as Awaited<ReturnType<typeof steveClient.getOcppTags>>;
      }),
      db.select().from(schema.userMappings),
    ]);

    const mappingByTagPk = new Map<number, schema.UserMapping>();
    for (const m of mappings) mappingByTagPk.set(m.steveOcppTagPk, m);

    // Tag primary key lookup for parent resolution.
    const tagPkByIdTag = new Map<string, number>();
    for (const t of ocppTags) tagPkByIdTag.set(t.idTag, t.ocppTagPk);

    // Child count per parent idTag — only meaningful for meta-tags but we
    // compute it uniformly.
    const childCountByParentIdTag = new Map<string, number>();
    for (const t of ocppTags) {
      if (t.parentIdTag) {
        childCountByParentIdTag.set(
          t.parentIdTag,
          (childCountByParentIdTag.get(t.parentIdTag) ?? 0) + 1,
        );
      }
    }

    // Build the row set from the StEvE roster.
    const allRows: TagListRow[] = ocppTags.map((t) => {
      const mapping = mappingByTagPk.get(t.ocppTagPk);
      const tagTypeRaw = mapping?.tagType ?? null;
      const tagType: TagType | null = tagTypeRaw && isTagType(tagTypeRaw)
        ? tagTypeRaw
        : null;
      const isMeta = isMetaTag(t.idTag);
      const parentIdTag = t.parentIdTag ?? null;
      const parentTagPk = parentIdTag
        ? tagPkByIdTag.get(parentIdTag) ?? null
        : null;
      const mappingId = mapping?.id ?? null;

      return {
        ocppTagPk: t.ocppTagPk,
        idTag: t.idTag,
        parentIdTag,
        parentTagPk,
        mappingId,
        displayName: mapping?.displayName ?? null,
        tagType,
        notes: mapping?.notes ?? null,
        isActive: mapping?.isActive ?? true,
        hasMapping: Boolean(mapping),
        hasLagoCustomer: Boolean(mapping?.lagoCustomerExternalId),
        isMeta,
        childCount: childCountByParentIdTag.get(t.idTag) ?? 0,
      };
    });

    // Totals are computed on the unfiltered population so the stat strip
    // always shows the real picture regardless of the current filter.
    const totals: TagsTotals = {
      all: allRows.length,
      linked: allRows.filter((r) => r.hasLagoCustomer).length,
      unlinked: allRows.filter((r) => !r.hasLagoCustomer).length,
      meta: allRows.filter((r) => r.isMeta).length,
      inactive: allRows.filter((r) => !r.isActive).length,
    };

    // Apply the URL filter.
    const qLower = filter.q.toLowerCase();
    const rows = allRows.filter((r) => {
      if (qLower) {
        const hay = `${r.idTag} ${r.displayName ?? ""} ${r.notes ?? ""}`
          .toLowerCase();
        if (!hay.includes(qLower)) return false;
      }
      if (filter.linked === "yes" && !r.hasLagoCustomer) return false;
      if (filter.linked === "no" && r.hasLagoCustomer) return false;
      if (filter.active === "yes" && !r.isActive) return false;
      if (filter.active === "no" && r.isActive) return false;
      if (filter.meta === "yes" && !r.isMeta) return false;
      if (filter.meta === "no" && r.isMeta) return false;
      if (filter.types.size > 0) {
        if (!r.tagType || !filter.types.has(r.tagType)) return false;
      }
      return true;
    });

    // Stable sort: meta-tags first, then alphabetic by idTag.
    rows.sort((a, b) => {
      if (a.isMeta !== b.isMeta) return a.isMeta ? -1 : 1;
      return a.idTag.localeCompare(b.idTag);
    });

    const data: TagsIndexData = {
      rows,
      totals,
      filter,
      grouping: "flat",
      steveFetchFailed,
    };
    return { data };
  },
});

// ---- Page -------------------------------------------------------------------

function serializeFilter(f: TagsFilterState): TagsFilterStateSerialized {
  return {
    q: f.q,
    linked: f.linked,
    active: f.active,
    meta: f.meta,
    types: Array.from(f.types),
  };
}

function EmptyState() {
  return (
    <BlurFade delay={0.05} duration={0.4} direction="up">
      <Card className="relative overflow-hidden border-dashed">
        <GridPattern
          width={24}
          height={24}
          className="absolute inset-0 -z-10 opacity-[0.04] [mask-image:radial-gradient(circle_at_center,white,transparent_70%)]"
          squares={[[1, 1], [3, 2], [5, 4], [7, 3]]}
        />
        <div class="flex flex-col items-center gap-4 px-6 py-12 text-center">
          <div
            class="flex size-14 items-center justify-center rounded-full bg-cyan-500/10"
            aria-hidden="true"
          >
            <Nfc class="h-7 w-7 text-cyan-500" />
          </div>
          <div>
            <h2 class="text-lg font-semibold">No tags yet</h2>
            <p class="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Scan a card at any charger to auto-import it, or create one
              manually.
            </p>
          </div>
          <div class="flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button variant="outline" asChild>
              <a href="/tags/new">
                <Plus class="mr-2 size-4" aria-hidden="true" />
                New tag
              </a>
            </Button>
          </div>
        </div>
      </Card>
    </BlurFade>
  );
}

function FilteredEmptyState() {
  return (
    <div class="col-span-full rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
      No tags match —{" "}
      <a href="/tags" class="underline hover:text-foreground">
        Clear filter
      </a>
    </div>
  );
}

export default define.page<typeof handler>(
  function TagsIndexPage({ data, url, state }) {
    const statActive = whichStatActive(data.filter);
    const statStripTotals: TagsStatStripTotals = data.totals;

    // Page-level empty state fires only when the unfiltered population is
    // zero. When filters narrow a non-empty roster to zero rows we show the
    // in-grid `FilteredEmptyState` instead.
    const showPageEmpty = data.totals.all === 0;

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="cyan"
      >
        <PageCard
          title="Tags"
          description={`${data.totals.all} OCPP tag${
            data.totals.all === 1 ? "" : "s"
          } known to StEvE. Edit display name, type, notes, and active flag per tag. Use the Tag Linking page to attach a tag to a Lago customer.`}
          colorScheme="cyan"
          headerActions={
            <a
              href="/tags/new"
              class="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Plus class="h-4 w-4" />
              New tag
            </a>
          }
        >
          {showPageEmpty ? <EmptyState /> : (
            <div class="flex flex-col gap-4">
              <TagsStatStrip totals={statStripTotals} active={statActive} />

              {data.steveFetchFailed
                ? (
                  <div
                    role="alert"
                    class="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-2 text-sm text-amber-700 dark:text-amber-400"
                  >
                    StEvE tag roster unavailable — displaying mappings only.
                  </div>
                )
                : null}

              <TagsFilterBar
                initial={serializeFilter(data.filter)}
                totalCount={data.totals.all}
              />

              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {data.rows.length === 0
                  ? <FilteredEmptyState />
                  : data.rows.map((row) => (
                    <TagListCard
                      key={row.ocppTagPk}
                      ocppTagPk={row.ocppTagPk}
                      idTag={row.idTag}
                      parentIdTag={row.parentIdTag}
                      displayName={row.displayName}
                      tagType={row.tagType}
                      notes={row.notes}
                      isActive={row.isActive}
                      isMeta={row.isMeta}
                      hasLagoCustomer={row.hasLagoCustomer}
                    />
                  ))}
              </div>
            </div>
          )}
        </PageCard>
      </SidebarLayout>
    );
  },
);

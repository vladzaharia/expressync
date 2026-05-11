/**
 * /admin/feature-flags — read-only registry view.
 *
 * Lists every flag in `FEATURE_FLAGS` with name, key, type, default,
 * description, and scope. Editing happens on the per-user and
 * per-device detail pages; this page is the canonical reference.
 */

import { define } from "../../../utils.ts";
import { SidebarLayout } from "../../../components/SidebarLayout.tsx";
import { PageCard } from "../../../components/PageCard.tsx";
import { SectionCard } from "../../../components/shared/SectionCard.tsx";
import { Flag } from "lucide-preact";
import { db } from "../../../src/db/index.ts";
import { globalFeatureFlagValues } from "../../../src/db/schema.ts";
import { FEATURE_FLAGS } from "../../../src/lib/devices/feature-flags.ts";
import GlobalFeatureFlagsForm from "../../../islands/feature-flags/GlobalFeatureFlagsForm.tsx";

interface FlagRow {
  key: string;
  name: string;
  description: string;
  defaultValue: unknown;
  type: string;
  /** Currently-set global value, undefined when unset. */
  globalValue: unknown | undefined;
}

interface PageData {
  flags: FlagRow[];
}

function typeLabel(v: unknown): string {
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "string") return "string";
  if (typeof v === "number") {
    return Number.isInteger(v) ? "int" : "double";
  }
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return "object";
}

export const handler = define.handlers({
  async GET(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin/login" },
      });
    }
    // Load any globally-set values so the editor reflects current state.
    const globalRows = await db
      .select({
        flagKey: globalFeatureFlagValues.flagKey,
        valueJson: globalFeatureFlagValues.valueJson,
      })
      .from(globalFeatureFlagValues);
    const globalByKey = new Map<string, unknown>(
      globalRows.map((r) => [r.flagKey, r.valueJson]),
    );

    const flags: FlagRow[] = Object.entries(FEATURE_FLAGS).map((
      [key, spec],
    ) => ({
      key,
      name: spec.name,
      description: spec.description,
      defaultValue: spec.defaultValue,
      type: typeLabel(spec.defaultValue),
      globalValue: globalByKey.has(key) ? globalByKey.get(key) : undefined,
    }));
    return { data: { flags } satisfies PageData };
  },
});

export default define.page<typeof handler>(
  function FeatureFlagsRegistryPage({ data, url, state }) {
    const { flags } = data as PageData;
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="indigo"
      >
        <PageCard
          title="Feature flags"
          description="Code-defined registry. Global values fall back to the registry default; per-user and per-device overrides are edited on each entity's detail page."
          colorScheme="indigo"
        >
          <SectionCard
            title={`${flags.length} flag${flags.length === 1 ? "" : "s"}`}
            description="Effective precedence: device override → user value → global value → registry default."
            icon={Flag}
            accent="indigo"
          >
            {flags.length === 0
              ? (
                <p class="text-sm text-muted-foreground">
                  The registry is empty. Add a flag in{" "}
                  <code>src/lib/devices/feature-flags.ts</code>.
                </p>
              )
              : (
                <GlobalFeatureFlagsForm
                  flags={flags.map((f) => ({
                    key: f.key,
                    name: f.name,
                    description: f.description,
                    kind: f.type as
                      | "bool"
                      | "string"
                      | "int"
                      | "double"
                      | "json",
                    defaultValue: f.defaultValue,
                    globalValue: f.globalValue,
                  }))}
                />
              )}
          </SectionCard>
        </PageCard>
      </SidebarLayout>
    );
  },
);

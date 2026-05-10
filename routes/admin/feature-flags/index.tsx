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
import { FEATURE_FLAGS } from "../../../src/lib/devices/feature-flags.ts";

interface FlagRow {
  key: string;
  name: string;
  description: string;
  scope: "user" | "device" | "both";
  defaultValue: unknown;
  type: string;
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

function valueToString(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const handler = define.handlers({
  GET(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin/login" },
      });
    }
    const flags: FlagRow[] = Object.entries(FEATURE_FLAGS).map((
      [key, spec],
    ) => ({
      key,
      name: spec.name,
      description: spec.description,
      scope: spec.scope,
      defaultValue: spec.defaultValue,
      type: typeLabel(spec.defaultValue),
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
          description="Code-defined registry. Values are assigned per-user and (optionally) per-device on each entity's detail page."
          colorScheme="indigo"
        >
          <SectionCard
            title={`${flags.length} flag${flags.length === 1 ? "" : "s"}`}
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
                <div class="overflow-x-auto">
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="border-b text-xs text-muted-foreground uppercase tracking-wide">
                        <th class="py-2 pr-3 text-left">Name / key</th>
                        <th class="py-2 pr-3 text-left">Type</th>
                        <th class="py-2 pr-3 text-left">Default</th>
                        <th class="py-2 pr-3 text-left">Scope</th>
                        <th class="py-2 text-left">Description</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-border">
                      {flags.map((f) => (
                        <tr key={f.key} class="align-top">
                          <td class="py-2 pr-3">
                            <div class="font-medium">{f.name}</div>
                            <div class="font-mono text-xs text-muted-foreground">
                              {f.key}
                            </div>
                          </td>
                          <td class="py-2 pr-3 font-mono text-xs">{f.type}</td>
                          <td class="py-2 pr-3 font-mono text-xs">
                            {valueToString(f.defaultValue)}
                          </td>
                          <td class="py-2 pr-3">
                            <span class="inline-flex items-center rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-700 dark:text-indigo-300 capitalize">
                              {f.scope}
                            </span>
                          </td>
                          <td class="py-2 text-sm text-muted-foreground">
                            {f.description}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </SectionCard>
        </PageCard>
      </SidebarLayout>
    );
  },
);

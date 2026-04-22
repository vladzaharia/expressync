import { define } from "../../utils.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import NewTagForm from "../../islands/NewTagForm.tsx";
import { steveClient } from "../../src/lib/steve-client.ts";
import { ArrowLeft } from "lucide-preact";
import { CHROME_SIZE } from "../../components/AppSidebar.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const prefilledIdTag = ctx.url.searchParams.get("idTag") ?? undefined;
    // Provide parent-tag autocomplete options so operators can pick an
    // existing rollup without memorizing prefixes.
    const allTags = await steveClient.getOcppTags().catch(() => []);
    const parentCandidates = allTags.map((t) => ({ idTag: t.idTag }));
    return { data: { prefilledIdTag, parentCandidates } };
  },
});

function BackAction() {
  return (
    <a
      href="/tags"
      className="flex items-center justify-center gap-2 px-4 transition-colors"
      style={{ height: CHROME_SIZE }}
    >
      <ArrowLeft className="size-5" />
      <span className="text-sm font-medium">Back</span>
    </a>
  );
}

export default define.page<typeof handler>(
  function NewTagPage({ data, url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="cyan"
        actions={<BackAction />}
      >
        <PageCard
          title="Create Tag"
          description="Register a new OCPP tag in StEvE and seed its metadata. Lago linking happens separately on the Tag Linking page."
          colorScheme="cyan"
        >
          <NewTagForm
            prefilledIdTag={data.prefilledIdTag}
            parentCandidates={data.parentCandidates}
          />
        </PageCard>
      </SidebarLayout>
    );
  },
);

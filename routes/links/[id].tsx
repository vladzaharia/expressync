import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import MappingForm from "../../islands/MappingForm.tsx";
import { ArrowLeft } from "lucide-preact";
import { CHROME_SIZE } from "../../components/AppSidebar.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const id = parseInt(ctx.params.id);
    if (isNaN(id)) {
      return ctx.redirect("/links");
    }

    const [mapping] = await db
      .select()
      .from(schema.userMappings)
      .where(eq(schema.userMappings.id, id))
      .limit(1);

    if (!mapping) {
      return ctx.redirect("/links");
    }

    return { data: { mapping } };
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
      <span className="text-sm font-medium hidden sm:inline">Back</span>
    </a>
  );
}

export default define.page<typeof handler>(
  function EditTagLinkingPage({ data, url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="violet"
        actions={<BackAction />}
      >
        <PageCard
          title="Edit Tag Link"
          description="Update the billing configuration for this OCPP tag."
          colorScheme="violet"
        >
          <MappingForm mapping={data.mapping} />
        </PageCard>
      </SidebarLayout>
    );
  },
);

import { define } from "../../utils.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import MappingForm from "../../islands/MappingForm.tsx";
import { ArrowLeft } from "lucide-preact";
import { CHROME_SIZE } from "../../components/AppSidebar.tsx";

export const handler = define.handlers({
  GET(_ctx) {
    return { data: {} };
  },
});

function BackAction() {
  return (
    <a
      href="/tag-linking"
      className="flex items-center justify-center gap-2 px-4 transition-colors"
      style={{ height: CHROME_SIZE }}
    >
      <ArrowLeft className="size-5" />
      <span className="text-sm font-medium hidden sm:inline">Back</span>
    </a>
  );
}

export default define.page<typeof handler>(
  function NewTagLinkingPage({ url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="violet"
        actions={<BackAction />}
      >
        <PageCard
          title="New Tag Link"
          description="Select an OCPP tag and link it to a Lago customer and subscription. Child tags will automatically inherit the parent's billing configuration."
          colorScheme="violet"
        >
          <MappingForm />
        </PageCard>
      </SidebarLayout>
    );
  },
);


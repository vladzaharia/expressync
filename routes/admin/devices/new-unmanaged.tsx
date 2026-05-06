/**
 * /admin/devices/new-unmanaged — admin form to register a non-OCPP charger.
 *
 * Used for Tesla Wall Connectors and other "dumb" units that don't speak
 * OCPP. POSTs to `/api/admin/chargers/unmanaged`; on success, redirects
 * to the charger detail page (`/admin/chargers/<id>`).
 *
 * Layout per CLAUDE.md: `SidebarLayout > PageCard > SectionCard`. Accent
 * `teal` to match the parent listing at `/admin/devices`.
 */

import { define } from "../../../utils.ts";
import { SidebarLayout } from "../../../components/SidebarLayout.tsx";
import { PageCard } from "../../../components/PageCard.tsx";
import { SectionCard } from "../../../components/shared/SectionCard.tsx";
import { BackAction } from "../../../components/shared/BackAction.tsx";
import NewUnmanagedChargerForm from "../../../islands/devices/NewUnmanagedChargerForm.tsx";

export const handler = define.handlers({
  GET(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return new Response("Forbidden", { status: 403 });
    }
    return { data: {} };
  },
});

export default define.page<typeof handler>(
  function NewUnmanagedChargerPage({ url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="teal"
        actions={<BackAction href="/admin/devices?type=charger" />}
      >
        <PageCard
          title="Add unmanaged charger"
          description="Register a Tesla Wall Connector or other non-OCPP charger. These chargers live entirely in our DB — no StEvE registration, no sessions, no billing."
          colorScheme="teal"
        >
          <SectionCard title="Charger identity" accent="teal">
            <NewUnmanagedChargerForm />
          </SectionCard>
        </PageCard>
      </SidebarLayout>
    );
  },
);

/**
 * Phase P5 — Charging Profile editor page.
 *
 * Accessed via sibling's Link-detail chip (/links/[id]) and Tag-detail
 * chip (/tags/[tagPk]). No top-level nav entry.
 */

import { define } from "../../../../utils.ts";
import { SidebarLayout } from "../../../../components/SidebarLayout.tsx";
import { PageCard } from "../../../../components/PageCard.tsx";
import { BackAction } from "../../../../components/shared/BackAction.tsx";
import { getProfile } from "../../../../src/services/charging-profile.service.ts";
import ProfileEditor from "../../../../islands/charging-profile/ProfileEditor.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const externalId = ctx.params.externalId;
    if (!externalId) return ctx.redirect("/links");
    const profile = await getProfile(externalId);
    return { data: { externalId, profile } };
  },
});

export default define.page<typeof handler>(
  function ChargingProfilePage({ data, url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="emerald"
        actions={<BackAction href="/links" />}
      >
        <PageCard
          title="Charging Profile"
          description={`Schedule and power cap for subscription ${data.externalId}.`}
          colorScheme="emerald"
        >
          <ProfileEditor
            externalId={data.externalId}
            initialProfile={data.profile
              ? {
                id: data.profile.id,
                preset: data.profile.preset as
                  | "unlimited"
                  | "offpeak"
                  | "cap7kw"
                  | "cap11kw"
                  | "solar"
                  | "custom",
                windows: (data.profile.windows as Array<
                  {
                    dayOfWeek: number;
                    startMin: number;
                    endMin: number;
                    maxW?: number;
                  }
                >) ?? [],
                maxWGlobal: data.profile.maxWGlobal,
                lagoSyncError: data.profile.lagoSyncError,
              }
              : null}
          />
        </PageCard>
      </SidebarLayout>
    );
  },
);

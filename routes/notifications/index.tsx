/**
 * /notifications — notification archive page.
 *
 * Server-rendered `PageCard colorScheme="sky"` shell with a hydrated
 * `NotificationArchiveTable` island. Loader fetches the first 25 rows so the
 * first paint is already populated.
 */

import { define } from "../../utils.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import NotificationArchiveTable from "../../islands/admin/NotificationArchiveTable.tsx";
import { listArchive } from "../../src/services/notification.service.ts";

export const handler = define.handlers({
  async GET(_ctx) {
    const { items, total } = await listArchive({ limit: 25, offset: 0 });
    return {
      data: { items, total },
    };
  },
});

export default define.page<typeof handler>(
  function NotificationsArchivePage({ data, url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="sky"
      >
        <PageCard
          title="Notifications"
          description={data.total === 0
            ? "No notifications yet. System and Lago events will appear here."
            : `${data.total} total notification${data.total === 1 ? "" : "s"}`}
          colorScheme="sky"
        >
          <NotificationArchiveTable
            initialItems={data.items}
            initialTotal={data.total}
          />
        </PageCard>
      </SidebarLayout>
    );
  },
);

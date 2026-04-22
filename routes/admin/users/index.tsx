import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { users } from "../../../src/db/schema.ts";
import { SidebarLayout } from "../../../components/SidebarLayout.tsx";
import { PageCard } from "../../../components/PageCard.tsx";
import UsersTable from "../../../islands/UsersTable.tsx";

export const handler = define.handlers({
  async GET(_ctx) {
    const allUsers = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users);

    return {
      data: {
        users: allUsers,
      },
    };
  },
});

export default define.page<typeof handler>(
  function UsersPage({ data, url, state }) {
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="amber"
      >
        <PageCard
          title="User Management"
          description={`${data.users.length} user${
            data.users.length !== 1 ? "s" : ""
          }`}
          colorScheme="amber"
        >
          <UsersTable
            users={data.users}
            currentUserId={state.user?.id ?? ""}
          />
        </PageCard>
      </SidebarLayout>
    );
  },
);

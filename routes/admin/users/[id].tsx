/**
 * /admin/users/[id] — minimum-viable user detail page.
 *
 * Surfaces the bits an operator needs when they land here from the
 * command-palette search: identity, role, sessions count, and (for
 * customers) their linked OCPP tags + Lago customer external id. Edit
 * affordances live on the index page's UsersTable for now; this page
 * is read-only.
 *
 * Customer-role detail also includes a deep link to the existing
 * /admin/links UI scoped to the customer's Lago id, plus a button that
 * navigates the admin into customer-impersonation mode (`?as=<id>`).
 */

import { eq } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { config } from "../../../src/lib/config.ts";
import { SidebarLayout } from "../../../components/SidebarLayout.tsx";
import { PageCard } from "../../../components/PageCard.tsx";
import { SectionCard } from "../../../components/shared/SectionCard.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Mail, Shield, Tag, UserCog } from "lucide-preact";

interface MappingRow {
  id: number;
  steveOcppIdTag: string;
  displayName: string | null;
  isActive: boolean;
  lagoCustomerExternalId: string | null;
  lagoSubscriptionExternalId: string | null;
}

interface UserData {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  emailVerified: boolean | null;
  createdAt: Date | null;
  onboardedAt: Date | null;
  lagoCustomerExternalId: string | null;
  mappings: MappingRow[];
  sessionCount: number;
}

export const handler = define.handlers({
  async GET(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin/login" },
      });
    }

    const userId = ctx.params.id;
    const [row] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!row) {
      return new Response("Not Found", { status: 404 });
    }

    const mappings = await db
      .select({
        id: schema.userMappings.id,
        steveOcppIdTag: schema.userMappings.steveOcppIdTag,
        displayName: schema.userMappings.displayName,
        isActive: schema.userMappings.isActive,
        lagoCustomerExternalId: schema.userMappings.lagoCustomerExternalId,
        lagoSubscriptionExternalId:
          schema.userMappings.lagoSubscriptionExternalId,
      })
      .from(schema.userMappings)
      .where(eq(schema.userMappings.userId, userId));

    // Session count (BetterAuth sessions table). Cheap COUNT, not
    // material to the page being slow.
    const sessions = await db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId));

    return {
      data: {
        user: {
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          emailVerified: row.emailVerified,
          createdAt: row.createdAt ?? null,
          onboardedAt: row.onboardedAt ?? null,
          lagoCustomerExternalId: row.lagoCustomerExternalId ?? null,
          mappings: mappings.map((m) => ({
            ...m,
            isActive: m.isActive ?? false,
          })),
          sessionCount: sessions.length,
        } satisfies UserData,
      },
    };
  },
});

export default define.page<typeof handler>(
  function UserDetail({ data, url, state }) {
    const u = (data as { user: UserData }).user;
    const isCustomer = u.role === "customer";
    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="amber"
      >
        <PageCard
          title={u.name?.trim() || u.email || u.id}
          description={u.email
            ? `${u.role} · ${u.email}`
            : `${u.role} · no email`}
          colorScheme="amber"
          headerActions={isCustomer
            ? (
              <Button variant="outline" size="sm" asChild>
                {
                  /* Cross-host link: impersonation only takes effect on the
                  customer surface (the middleware reads ?as= there). */
                }
                <a
                  href={`${config.CUSTOMER_BASE_URL}/?as=${
                    encodeURIComponent(u.id)
                  }`}
                >
                  <UserCog class="mr-2 h-4 w-4" /> View as customer
                </a>
              </Button>
            )
            : undefined}
        >
          <div class="grid gap-4 md:grid-cols-2">
            <SectionCard title="Identity" icon={Mail} accent="amber">
              <dl class="grid grid-cols-3 gap-y-2 text-sm">
                <dt class="text-muted-foreground">User id</dt>
                <dd class="col-span-2 font-mono text-xs break-all">{u.id}</dd>
                <dt class="text-muted-foreground">Name</dt>
                <dd class="col-span-2">{u.name ?? "—"}</dd>
                <dt class="text-muted-foreground">Email</dt>
                <dd class="col-span-2">{u.email ?? "—"}</dd>
                <dt class="text-muted-foreground">Verified</dt>
                <dd class="col-span-2">{u.emailVerified ? "Yes" : "No"}</dd>
                <dt class="text-muted-foreground">Created</dt>
                <dd class="col-span-2">
                  {u.createdAt ? new Date(u.createdAt).toLocaleString() : "—"}
                </dd>
                {isCustomer && (
                  <>
                    <dt class="text-muted-foreground">Onboarded</dt>
                    <dd class="col-span-2">
                      {u.onboardedAt
                        ? new Date(u.onboardedAt).toLocaleString()
                        : "Not yet"}
                    </dd>
                    <dt class="text-muted-foreground">Lago id</dt>
                    <dd class="col-span-2 font-mono text-xs break-all">
                      {u.lagoCustomerExternalId ?? "—"}
                    </dd>
                  </>
                )}
              </dl>
            </SectionCard>
            <SectionCard title="Access" icon={Shield} accent="amber">
              <dl class="grid grid-cols-3 gap-y-2 text-sm">
                <dt class="text-muted-foreground">Role</dt>
                <dd class="col-span-2">{u.role}</dd>
                <dt class="text-muted-foreground">Sessions</dt>
                <dd class="col-span-2">{u.sessionCount}</dd>
              </dl>
            </SectionCard>
          </div>
          {isCustomer && (
            <div class="mt-4">
              <SectionCard
                title="Linked EV cards"
                description={`${u.mappings.length} mapping${
                  u.mappings.length !== 1 ? "s" : ""
                }`}
                icon={Tag}
                accent="amber"
                actions={u.lagoCustomerExternalId
                  ? (
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={`/links?customerId=${
                          encodeURIComponent(u.lagoCustomerExternalId)
                        }`}
                      >
                        Manage links
                      </a>
                    </Button>
                  )
                  : undefined}
              >
                {u.mappings.length === 0
                  ? (
                    <p class="text-sm text-muted-foreground">
                      No EV cards linked to this account yet.
                    </p>
                  )
                  : (
                    <ul class="divide-y divide-border text-sm">
                      {u.mappings.map((m: MappingRow) => (
                        <li
                          key={m.id}
                          class="flex items-center justify-between py-2"
                        >
                          <div>
                            <a
                              href={`/tags?idTag=${
                                encodeURIComponent(m.steveOcppIdTag)
                              }`}
                              class="font-medium hover:underline"
                            >
                              {m.displayName?.trim() || m.steveOcppIdTag}
                            </a>
                            {m.displayName && (
                              <span class="ml-2 font-mono text-xs text-muted-foreground">
                                {m.steveOcppIdTag}
                              </span>
                            )}
                          </div>
                          <span
                            class={`rounded-full px-2 py-0.5 text-xs ${
                              m.isActive
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {m.isActive ? "Active" : "Inactive"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
              </SectionCard>
            </div>
          )}
        </PageCard>
      </SidebarLayout>
    );
  },
);

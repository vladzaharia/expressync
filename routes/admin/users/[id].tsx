/**
 * /admin/users/[id] — comprehensive user detail page.
 *
 * One-stop information hub for an operator landing here from the
 * command palette. Section ordering is deliberate:
 *
 *   1. Identity (always)            — name, email, role, dates, public ID
 *   2. Lago profile (customer only) — external link to billing
 *   3. EV cards (customer only)     — linked OCPP tags
 *   4. Devices (always)             — every registered device
 *   5. Auth & sessions (always)     — active sessions + linked accounts
 *
 * Indigo accent across the page (chargers = orange, devices = teal,
 * users = indigo) gives an at-a-glance signal of which entity kind
 * you're looking at.
 *
 * The 2026-05-06 admin-to-customer impersonation button (`?as=<id>`
 * link in the header) has been removed. The middleware mechanism is
 * left intact for emergency support escalations but no longer
 * exposed in the admin UI.
 */

import { and, desc, eq, gt } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { config } from "../../../src/lib/config.ts";
import { SidebarLayout } from "../../../components/SidebarLayout.tsx";
import { PageCard } from "../../../components/PageCard.tsx";
import { SectionCard } from "../../../components/shared/SectionCard.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { CapabilityPill } from "../../../components/devices/CapabilityPill.tsx";
import { PublicIdDisplay } from "../../../components/shared/PublicIdDisplay.tsx";
import PublicIdQrPopover from "../../../islands/shared/PublicIdQrPopover.tsx";
import RevokeSessionButton from "../../../islands/users/RevokeSessionButton.tsx";
import {
  CreditCard,
  ExternalLink,
  Mail,
  Shield,
  Smartphone,
  Tag,
  User,
} from "lucide-preact";

interface MappingRow {
  id: number;
  steveOcppIdTag: string;
  displayName: string | null;
  isActive: boolean;
  deviceId: string | null;
}

interface DeviceRow {
  id: string;
  kind: string;
  label: string;
  capabilities: string[];
  lastSeenAtIso: string | null;
  registeredAtIso: string | null;
  isOnline: boolean;
}

interface SessionRow {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAtIso: string | null;
  updatedAtIso: string | null;
  expiresAtIso: string | null;
}

interface AccountRow {
  id: string;
  providerId: string;
  accountId: string;
  createdAtIso: string | null;
}

interface UserData {
  id: string;
  publicId: string;
  name: string | null;
  email: string | null;
  role: string;
  emailVerified: boolean | null;
  createdAtIso: string | null;
  onboardedAtIso: string | null;
  lagoCustomerExternalId: string | null;
  mappings: MappingRow[];
  devices: DeviceRow[];
  activeSessions: SessionRow[];
  accounts: AccountRow[];
}

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

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

    const [mappings, deviceRows, sessionRows, accountRows] = await Promise.all([
      db
        .select({
          id: schema.userMappings.id,
          steveOcppIdTag: schema.userMappings.steveOcppIdTag,
          displayName: schema.userMappings.displayName,
          isActive: schema.userMappings.isActive,
          deviceId: schema.userMappings.deviceId,
        })
        .from(schema.userMappings)
        .where(eq(schema.userMappings.userId, userId)),
      db
        .select({
          id: schema.devices.id,
          kind: schema.devices.kind,
          label: schema.devices.label,
          capabilities: schema.devices.capabilities,
          lastSeenAt: schema.devices.lastSeenAt,
          registeredAt: schema.devices.registeredAt,
        })
        .from(schema.devices)
        .where(eq(schema.devices.ownerUserId, userId)),
      db
        .select({
          id: schema.sessions.id,
          ipAddress: schema.sessions.ipAddress,
          userAgent: schema.sessions.userAgent,
          createdAt: schema.sessions.createdAt,
          updatedAt: schema.sessions.updatedAt,
          expiresAt: schema.sessions.expiresAt,
        })
        .from(schema.sessions)
        .where(
          and(
            eq(schema.sessions.userId, userId),
            gt(schema.sessions.expiresAt, new Date()),
          ),
        )
        .orderBy(desc(schema.sessions.updatedAt))
        .limit(50),
      db
        .select({
          id: schema.accounts.id,
          providerId: schema.accounts.providerId,
          accountId: schema.accounts.accountId,
          createdAt: schema.accounts.createdAt,
        })
        .from(schema.accounts)
        .where(eq(schema.accounts.userId, userId)),
    ]);

    const now = Date.now();
    const devices: DeviceRow[] = deviceRows.map((d) => ({
      id: d.id,
      kind: d.kind,
      label: d.label,
      capabilities: d.capabilities ?? [],
      lastSeenAtIso: d.lastSeenAt?.toISOString() ?? null,
      registeredAtIso: d.registeredAt?.toISOString() ?? null,
      isOnline: d.lastSeenAt
        ? now - d.lastSeenAt.getTime() < ONLINE_WINDOW_MS
        : false,
    }));

    return {
      data: {
        user: {
          id: row.id,
          publicId: row.publicId,
          name: row.name,
          email: row.email,
          role: row.role,
          emailVerified: row.emailVerified,
          createdAtIso: row.createdAt?.toISOString() ?? null,
          onboardedAtIso: row.onboardedAt?.toISOString() ?? null,
          lagoCustomerExternalId: row.lagoCustomerExternalId ?? null,
          mappings: mappings.map((m) => ({
            ...m,
            isActive: m.isActive ?? false,
          })),
          devices,
          activeSessions: sessionRows.map((s) => ({
            id: s.id,
            ipAddress: s.ipAddress,
            userAgent: s.userAgent,
            createdAtIso: s.createdAt?.toISOString() ?? null,
            updatedAtIso: s.updatedAt?.toISOString() ?? null,
            expiresAtIso: s.expiresAt?.toISOString() ?? null,
          })),
          accounts: accountRows.map((a) => ({
            id: a.id,
            providerId: a.providerId,
            accountId: a.accountId,
            createdAtIso: a.createdAt?.toISOString() ?? null,
          })),
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
        accentColor="indigo"
      >
        <PageCard
          title={u.name?.trim() || u.email || u.id}
          description={u.email
            ? `${u.role} · ${u.email}`
            : `${u.role} · no email`}
          colorScheme="indigo"
          topRightAccessory={
            <PublicIdQrPopover
              entity="user"
              publicId={u.publicId}
              size="md"
            />
          }
        >
          <div class="flex flex-col gap-6">
            <IdentitySection user={u} isCustomer={isCustomer} />
            {isCustomer && u.lagoCustomerExternalId && (
              <LagoSection lagoCustomerExternalId={u.lagoCustomerExternalId} />
            )}
            {isCustomer && (
              <EvCardsSection
                mappings={u.mappings}
                lagoCustomerExternalId={u.lagoCustomerExternalId}
              />
            )}
            <DevicesSection devices={u.devices} />
            <AuthSessionsSection
              userId={u.id}
              sessions={u.activeSessions}
              accounts={u.accounts}
            />
          </div>
        </PageCard>
      </SidebarLayout>
    );
  },
);

function IdentitySection(
  { user: u, isCustomer }: { user: UserData; isCustomer: boolean },
) {
  return (
    <SectionCard title="Identity" icon={Mail} accent="indigo">
      <dl class="grid grid-cols-3 gap-y-2 text-sm">
        <dt class="text-muted-foreground">Public ID</dt>
        <dd class="col-span-2">
          <PublicIdDisplay publicId={u.publicId} size="sm" />
        </dd>
        <dt class="text-muted-foreground">User ID</dt>
        <dd class="col-span-2 font-mono text-xs break-all">{u.id}</dd>
        <dt class="text-muted-foreground">Name</dt>
        <dd class="col-span-2">{u.name ?? "—"}</dd>
        <dt class="text-muted-foreground">Email</dt>
        <dd class="col-span-2">
          {u.email ?? "—"}
          {u.email && u.emailVerified === false && (
            <span class="ml-2 text-xs text-amber-600 dark:text-amber-400">
              unverified
            </span>
          )}
        </dd>
        <dt class="text-muted-foreground">Role</dt>
        <dd class="col-span-2 capitalize">{u.role}</dd>
        <dt class="text-muted-foreground">Created</dt>
        <dd class="col-span-2">
          {u.createdAtIso ? new Date(u.createdAtIso).toLocaleString() : "—"}
        </dd>
        {isCustomer && (
          <>
            <dt class="text-muted-foreground">Onboarded</dt>
            <dd class="col-span-2">
              {u.onboardedAtIso
                ? new Date(u.onboardedAtIso).toLocaleString()
                : "Not yet"}
            </dd>
            <dt class="text-muted-foreground">Lago ID</dt>
            <dd class="col-span-2 font-mono text-xs break-all">
              {u.lagoCustomerExternalId ?? "—"}
            </dd>
          </>
        )}
      </dl>
    </SectionCard>
  );
}

function LagoSection(
  { lagoCustomerExternalId }: { lagoCustomerExternalId: string },
) {
  const lagoUrl = config.LAGO_DASHBOARD_URL
    ? `${config.LAGO_DASHBOARD_URL}/customers/${
      encodeURIComponent(lagoCustomerExternalId)
    }`
    : null;
  return (
    <SectionCard
      title="Lago profile"
      icon={CreditCard}
      accent="indigo"
      actions={lagoUrl
        ? (
          <Button variant="outline" size="sm" asChild>
            <a href={lagoUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink class="mr-2 h-4 w-4" />
              Open in Lago
            </a>
          </Button>
        )
        : undefined}
    >
      <p class="text-sm text-muted-foreground">
        Billing details, subscriptions, and invoices live in Lago.
      </p>
    </SectionCard>
  );
}

function EvCardsSection(
  { mappings, lagoCustomerExternalId }: {
    mappings: MappingRow[];
    lagoCustomerExternalId: string | null;
  },
) {
  return (
    <SectionCard
      title="EV cards & device tags"
      description={`${mappings.length} mapping${
        mappings.length !== 1 ? "s" : ""
      }`}
      icon={Tag}
      accent="indigo"
      actions={lagoCustomerExternalId
        ? (
          <Button variant="outline" size="sm" asChild>
            <a
              href={`/admin/tags?linked=1&q=${
                encodeURIComponent(lagoCustomerExternalId)
              }`}
            >
              Manage cards
            </a>
          </Button>
        )
        : undefined}
    >
      {mappings.length === 0
        ? (
          <p class="text-sm text-muted-foreground">
            No EV cards or device tags linked to this account yet.
          </p>
        )
        : (
          <ul class="divide-y divide-border text-sm">
            {mappings.map((m) => (
              <li
                key={m.id}
                class="flex items-center justify-between py-2"
              >
                <div>
                  <a
                    href={`/admin/tags?idTag=${
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
                  {m.deviceId && (
                    <span class="ml-2 inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-700 dark:text-cyan-300">
                      device
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
  );
}

function DevicesSection({ devices }: { devices: DeviceRow[] }) {
  return (
    <SectionCard
      title="Devices"
      description={`${devices.length} registered device${
        devices.length !== 1 ? "s" : ""
      }`}
      icon={Smartphone}
      accent="indigo"
    >
      {devices.length === 0
        ? (
          <p class="text-sm text-muted-foreground">
            No devices registered.
          </p>
        )
        : (
          <ul class="divide-y divide-border text-sm">
            {devices.map((d) => (
              <li
                key={d.id}
                class="flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div class="flex-1 min-w-0">
                  <a
                    href={`/admin/devices/${encodeURIComponent(d.id)}`}
                    class="font-medium hover:underline"
                  >
                    {d.label}
                  </a>
                  <div class="mt-1 flex flex-wrap items-center gap-2">
                    <span class="text-xs text-muted-foreground">{d.kind}</span>
                    {d.capabilities.map((c) => (
                      <CapabilityPill key={c} capability={c} />
                    ))}
                  </div>
                </div>
                <div class="text-right">
                  <span
                    class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                      d.isOnline
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "border-border bg-muted/40 text-muted-foreground"
                    }`}
                  >
                    {d.isOnline ? "Online" : "Offline"}
                  </span>
                  <p class="mt-1 text-xs text-muted-foreground">
                    {d.lastSeenAtIso
                      ? `Seen ${new Date(d.lastSeenAtIso).toLocaleString()}`
                      : "Never seen"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
    </SectionCard>
  );
}

function AuthSessionsSection(
  { userId, sessions, accounts }: {
    userId: string;
    sessions: SessionRow[];
    accounts: AccountRow[];
  },
) {
  const providerLabel = (id: string) => {
    if (id === "credential") return "Email/Password";
    if (id === "magic-link") return "Magic Link";
    if (id === "pocket-id") return "Pocket ID";
    return id;
  };

  return (
    <SectionCard
      title="Authentication & sessions"
      description={`${sessions.length} active session${
        sessions.length !== 1 ? "s" : ""
      }`}
      icon={Shield}
      accent="indigo"
    >
      <div class="flex flex-col gap-6">
        <div>
          <h4 class="mb-2 text-sm font-medium">Active sessions</h4>
          {sessions.length === 0
            ? <p class="text-sm text-muted-foreground">No active sessions.</p>
            : (
              <div class="overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="border-b text-xs text-muted-foreground uppercase tracking-wide">
                      <th class="py-2 pr-2 text-left">Last activity</th>
                      <th class="py-2 pr-2 text-left">IP</th>
                      <th class="py-2 pr-2 text-left">User agent</th>
                      <th class="py-2 pr-2 text-right">Expires</th>
                      <th class="py-2 text-right" />
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-border">
                    {sessions.map((s) => (
                      <tr key={s.id}>
                        <td class="py-2 pr-2 text-xs">
                          {s.updatedAtIso
                            ? new Date(s.updatedAtIso).toLocaleString()
                            : "—"}
                        </td>
                        <td class="py-2 pr-2 font-mono text-xs">
                          {s.ipAddress ?? "—"}
                        </td>
                        <td class="py-2 pr-2 text-xs text-muted-foreground max-w-[24rem] truncate">
                          {s.userAgent ?? "—"}
                        </td>
                        <td class="py-2 pr-2 text-right text-xs text-muted-foreground">
                          {s.expiresAtIso
                            ? new Date(s.expiresAtIso).toLocaleString()
                            : "—"}
                        </td>
                        <td class="py-2 text-right">
                          <RevokeSessionButton
                            userId={userId}
                            sessionId={s.id}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>

        <div>
          <h4 class="mb-2 text-sm font-medium">Linked accounts</h4>
          {accounts.length === 0
            ? (
              <p class="text-sm text-muted-foreground">
                No linked auth providers.
              </p>
            )
            : (
              <ul class="flex flex-wrap gap-2">
                {accounts.map((a) => (
                  <li
                    key={a.id}
                    class="inline-flex items-center gap-2 rounded-full border bg-muted/30 px-3 py-1 text-xs"
                  >
                    <User class="size-3" aria-hidden />
                    <span class="font-medium">
                      {providerLabel(a.providerId)}
                    </span>
                    <span class="font-mono text-muted-foreground truncate max-w-[12rem]">
                      {a.accountId}
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>
    </SectionCard>
  );
}

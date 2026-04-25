/**
 * Tests for `customer-account-provisioner.ts`.
 *
 * No live DB in unit tests — we exercise the resolver against an in-memory
 * fake `tx` that mimics Drizzle's chained query builder. This lets the
 * decision tree run end-to-end without spinning up Postgres.
 *
 * Coverage:
 *   - Sibling lookup: 0 rows → continue, 1 row → reuse
 *   - Lago no-email → 422 LAGO_EMAIL_MISSING
 *   - Lago malformed email → 422 LAGO_EMAIL_MALFORMED
 *   - Lago 404 → 422 LAGO_CUSTOMER_NOT_FOUND
 *   - Lago 5xx → 502 LAGO_FETCH_FAILED
 *   - Existing admin → 409 EMAIL_BELONGS_TO_ADMIN
 *   - Email already linked elsewhere → 409 EMAIL_LINKED_TO_DIFFERENT_LAGO_CUSTOMER
 *   - Idempotent re-link via email match
 *   - PG 23505 race during create → retry → reuse
 *   - Case-insensitive email lookup
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  type DrizzleTx,
  ProvisionerError,
  resolveOrCreateCustomerAccount,
} from "./customer-account-provisioner.ts";
import { lagoClient } from "../lib/lago-client.ts";
import type { LagoCustomer } from "../lib/types/lago.ts";

// ----------------------------------------------------------------------------
// In-memory fake of the slice of Drizzle's query builder the resolver uses.
// We rely on the *shape* of the projected columns (selected fields) to
// disambiguate which query the resolver intends. Predicate values are passed
// through `lookup*` slots on the store rather than parsing Drizzle's opaque
// SQL chunks.
// ----------------------------------------------------------------------------

interface FakeUserRow {
  id: string;
  email: string;
  role: "admin" | "customer";
}

interface FakeMappingRow {
  id: number;
  userId: string | null;
  lagoCustomerExternalId: string | null;
  createdAt: Date;
}

interface FakeStore {
  users: FakeUserRow[];
  mappings: FakeMappingRow[];
  /** When set, the next user INSERT throws an Error mimicking PG 23505. */
  raceOnNextInsert: boolean;
  /** Email the resolver is currently looking up (set per test). */
  lookupEmail?: string;
  /** UserId being checked for conflicting Lago links (set per test). */
  lookupUserId?: string;
  /** LagoId being negotiated by the resolver (set per test). */
  lookupLagoId?: string;
}

function newStore(seed: Partial<FakeStore> = {}): FakeStore {
  return {
    users: seed.users ?? [],
    mappings: seed.mappings ?? [],
    raceOnNextInsert: seed.raceOnNextInsert ?? false,
    lookupEmail: seed.lookupEmail,
    lookupUserId: seed.lookupUserId,
    lookupLagoId: seed.lookupLagoId,
  };
}

type SelectShape =
  | "sibling_distinct"
  | "user_email_by_id"
  | "user_by_email"
  | "conflicting_lago"
  | "most_recent_lago";

function createSmartTx(store: FakeStore): {
  tx: DrizzleTx;
  inserted: FakeUserRow[];
} {
  const inserted: FakeUserRow[] = [];
  let pending: SelectShape | null = null;

  function execute(): Promise<unknown[]> {
    const shape = pending;
    pending = null;
    switch (shape) {
      case "sibling_distinct": {
        // Mirror the resolver's intent: find DISTINCT user_ids on
        // user_mappings WHERE lago_customer_external_id = $1 AND user_id IS
        // NOT NULL. The resolver always passes the same lagoCustomerExternalId
        // captured by the test in `store.lookupLagoId`.
        const target = store.lookupLagoId;
        const seen = new Set<string>();
        const out: Array<{ userId: string }> = [];
        for (const m of store.mappings) {
          if (
            m.userId &&
            m.lagoCustomerExternalId === target &&
            !seen.has(m.userId)
          ) {
            seen.add(m.userId);
            out.push({ userId: m.userId });
          }
        }
        return Promise.resolve(out);
      }
      case "user_email_by_id": {
        const targetId = store.mappings.find((m) => m.userId !== null)?.userId;
        const u = store.users.find((u) => u.id === targetId);
        return Promise.resolve(u ? [{ email: u.email }] : []);
      }
      case "user_by_email": {
        const email = store.lookupEmail ?? "";
        const u = store.users.find(
          (u) => u.email.toLowerCase() === email.toLowerCase(),
        );
        return Promise.resolve(
          u ? [{ id: u.id, role: u.role, email: u.email }] : [],
        );
      }
      case "conflicting_lago": {
        const uid = store.lookupUserId ?? "";
        const lagoId = store.lookupLagoId ?? "";
        const conflict = store.mappings.find(
          (m) =>
            m.userId === uid &&
            m.lagoCustomerExternalId !== null &&
            m.lagoCustomerExternalId !== lagoId,
        );
        return Promise.resolve(
          conflict ? [{ lagoId: conflict.lagoCustomerExternalId }] : [],
        );
      }
      case "most_recent_lago": {
        const lagoId = store.lookupLagoId ?? "";
        const candidates = store.mappings
          .filter(
            (m) => m.lagoCustomerExternalId === lagoId && m.userId !== null,
          )
          .sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        return Promise.resolve(
          candidates.length > 0 ? [{ userId: candidates[0].userId }] : [],
        );
      }
      default:
        return Promise.resolve([]);
    }
  }

  function chain() {
    return {
      from(_table: unknown) {
        return {
          where(_pred: unknown) {
            return {
              orderBy(_o: unknown) {
                pending = "most_recent_lago";
                return {
                  limit(_n: number) {
                    return execute();
                  },
                  then(onFulfilled: (rows: unknown[]) => unknown) {
                    return execute().then(onFulfilled);
                  },
                };
              },
              limit(_n: number) {
                return execute();
              },
              then(onFulfilled: (rows: unknown[]) => unknown) {
                return execute().then(onFulfilled);
              },
            };
          },
        };
      },
    };
  }

  const tx = {
    selectDistinct(_cols: { userId?: unknown }) {
      pending = "sibling_distinct";
      return chain();
    },
    select(cols?: Record<string, unknown>) {
      const keys = cols ? Object.keys(cols) : [];
      if (keys.length === 1 && keys[0] === "email") {
        pending = "user_email_by_id";
      } else if (
        keys.length === 3 && keys.includes("id") && keys.includes("role") &&
        keys.includes("email")
      ) {
        pending = "user_by_email";
      } else if (keys.length === 1 && keys[0] === "lagoId") {
        pending = "conflicting_lago";
      } else if (keys.length === 1 && keys[0] === "userId") {
        pending = "most_recent_lago";
      }
      return chain();
    },
    insert(_table: unknown) {
      return {
        values(input: {
          id?: string;
          email?: string;
          role?: string;
          name?: string;
        }) {
          if (store.raceOnNextInsert) {
            store.raceOnNextInsert = false;
            const err = new Error(
              "duplicate key value violates unique constraint",
            ) as Error & { code: string };
            err.code = "23505";
            throw err;
          }
          const id = String(input.id ?? crypto.randomUUID());
          const u: FakeUserRow = {
            id,
            email: String(input.email ?? ""),
            role: (input.role as "admin" | "customer") ?? "customer",
          };
          store.users.push(u);
          inserted.push(u);
          return {
            returning(_cols: unknown) {
              return Promise.resolve([{ id: u.id, email: u.email }]);
            },
          };
        },
      };
    },
    /**
     * Drizzle's `update(table).set({...}).where(predicate)` chain. The
     * provisioner uses this to back-fill `users.lagoCustomerExternalId`
     * when an existing email-matched account is reused. We resolve the
     * target user via the most recently set `lookupUserId` (or fall
     * through to email match) and patch in-place; the predicate's
     * "only if NULL" guard is enforced manually here so re-runs are
     * safe.
     */
    update(_table: unknown) {
      return {
        set(patch: Record<string, unknown>) {
          return {
            where(_predicate: unknown) {
              const targetUserId = store.lookupUserId;
              const targetEmail = store.lookupEmail?.toLowerCase();
              for (const u of store.users) {
                if (
                  (targetUserId && u.id === targetUserId) ||
                  (targetEmail && u.email.toLowerCase() === targetEmail)
                ) {
                  if (patch.lagoCustomerExternalId !== undefined) {
                    (u as unknown as {
                      lagoCustomerExternalId?: string | null;
                    })
                      .lagoCustomerExternalId =
                        patch.lagoCustomerExternalId as string;
                  }
                }
              }
              return Promise.resolve();
            },
          };
        },
      };
    },
  };

  return { tx: tx as unknown as DrizzleTx, inserted };
}

// ----------------------------------------------------------------------------
// Lago client mock helper. Replaces `lagoClient.getCustomer` for the duration
// of the test and restores it afterwards.
// ----------------------------------------------------------------------------

interface FakeLagoCustomerInput {
  external_id: string;
  email: string | null;
  name: string | null;
  firstname: string | null;
  lastname: string | null;
}

function asFakeLagoCustomer(input: FakeLagoCustomerInput): LagoCustomer {
  // Cast through `unknown` because we don't need the full LagoCustomer shape
  // for the resolver — only `email`, `name`, `firstname`, `lastname`. The
  // resolver code reads only these fields, so the cast is safe in tests.
  return input as unknown as LagoCustomer;
}

function withMockedLago(
  customer: FakeLagoCustomerInput | "404" | "5xx",
  fn: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    const original = lagoClient.getCustomer.bind(lagoClient);
    type GetCustomerFn = typeof lagoClient.getCustomer;
    (lagoClient as unknown as { getCustomer: GetCustomerFn }).getCustomer =
      (async (id: string) => {
        if (customer === "404") {
          throw new Error(
            `Lago API returned status 404 for customer ${id}`,
          );
        }
        if (customer === "5xx") {
          throw new Error(
            `Lago API returned status 502 for customer ${id}`,
          );
        }
        return await Promise.resolve({
          customer: asFakeLagoCustomer(customer),
        });
      }) as GetCustomerFn;
    try {
      await fn();
    } finally {
      (lagoClient as unknown as { getCustomer: GetCustomerFn }).getCustomer =
        original;
    }
  };
}

// =============================================================================
// Tests
// =============================================================================

Deno.test("ProvisionerError — code → status mapping", () => {
  const cases: Array<[string, number]> = [
    ["LAGO_CUSTOMER_NOT_FOUND", 422],
    ["LAGO_FETCH_FAILED", 502],
    ["LAGO_EMAIL_MISSING", 422],
    ["LAGO_EMAIL_MALFORMED", 422],
    ["EMAIL_BELONGS_TO_ADMIN", 409],
    ["EMAIL_LINKED_TO_DIFFERENT_LAGO_CUSTOMER", 409],
  ];
  for (const [code, status] of cases) {
    // deno-lint-ignore no-explicit-any
    const err = new ProvisionerError(code as any, "msg");
    assertEquals(err.status, status, `${code} should map to ${status}`);
    assertEquals(err.code, code);
    assertEquals(err.name, "ProvisionerError");
  }
});

Deno.test(
  "happy path — no sibling, no existing user → CREATE",
  withMockedLago(
    {
      external_id: "cust_001",
      email: "alice@example.com",
      name: "Alice",
      firstname: null,
      lastname: null,
    },
    async () => {
      const store = newStore({
        lookupEmail: "alice@example.com",
        lookupLagoId: "cust_001",
      });
      const { tx, inserted } = createSmartTx(store);

      const result = await resolveOrCreateCustomerAccount(tx, "cust_001");

      assertEquals(result.created, true);
      assertEquals(result.reused, false);
      assertEquals(result.email, "alice@example.com");
      assertEquals(inserted.length, 1);
      assertEquals(inserted[0].role, "customer");
      assertEquals(inserted[0].email, "alice@example.com");
    },
  ),
);

Deno.test(
  "sibling lookup — existing mapping reuses userId",
  withMockedLago(
    {
      external_id: "cust_002",
      email: "bob@example.com",
      name: "Bob",
      firstname: null,
      lastname: null,
    },
    async () => {
      const existingUserId = "user_existing_bob";
      const store = newStore({
        users: [{
          id: existingUserId,
          email: "bob@example.com",
          role: "customer",
        }],
        mappings: [{
          id: 1,
          userId: existingUserId,
          lagoCustomerExternalId: "cust_002",
          createdAt: new Date(),
        }],
        lookupEmail: "bob@example.com",
        lookupLagoId: "cust_002",
      });
      const { tx, inserted } = createSmartTx(store);

      const result = await resolveOrCreateCustomerAccount(tx, "cust_002");

      assertEquals(result.created, false);
      assertEquals(result.reused, true);
      assertEquals(result.userId, existingUserId);
      assertEquals(inserted.length, 0);
    },
  ),
);

Deno.test(
  "Lago email missing → graceful no-email account creation",
  withMockedLago(
    {
      external_id: "cust_no_email",
      email: null,
      name: "X",
      firstname: null,
      lastname: null,
    },
    async () => {
      const store = newStore({ lookupLagoId: "cust_no_email" });
      const { tx, inserted } = createSmartTx(store);
      const result = await resolveOrCreateCustomerAccount(tx, "cust_no_email");
      // Customer account is created with email=null; scan-to-login still
      // works, magic-link / outbound-email flows skip silently.
      assertEquals(result.created, true);
      assertEquals(result.reused, false);
      // Mock store coerces null inserts to "" — production schema stores
      // NULL via the now-nullable email column. Either represents "no
      // usable email" for downstream `hasUsableEmail()` checks.
      assert(!result.email);
      assertEquals(inserted.length, 1);
      assert(!inserted[0].email);
    },
  ),
);

Deno.test(
  "Lago email malformed → 422 LAGO_EMAIL_MALFORMED",
  withMockedLago(
    {
      external_id: "cust_bad_email",
      email: "not-an-email",
      name: "X",
      firstname: null,
      lastname: null,
    },
    async () => {
      const store = newStore({ lookupLagoId: "cust_bad_email" });
      const { tx } = createSmartTx(store);
      const err = await assertRejects(
        () => resolveOrCreateCustomerAccount(tx, "cust_bad_email"),
        ProvisionerError,
      );
      assertEquals(err.code, "LAGO_EMAIL_MALFORMED");
    },
  ),
);

Deno.test(
  "Lago 404 → 422 LAGO_CUSTOMER_NOT_FOUND",
  withMockedLago("404", async () => {
    const store = newStore({ lookupLagoId: "cust_missing" });
    const { tx } = createSmartTx(store);
    const err = await assertRejects(
      () => resolveOrCreateCustomerAccount(tx, "cust_missing"),
      ProvisionerError,
    );
    assertEquals(err.code, "LAGO_CUSTOMER_NOT_FOUND");
  }),
);

Deno.test(
  "Lago 5xx → 502 LAGO_FETCH_FAILED",
  withMockedLago("5xx", async () => {
    const store = newStore({ lookupLagoId: "cust_5xx" });
    const { tx } = createSmartTx(store);
    const err = await assertRejects(
      () => resolveOrCreateCustomerAccount(tx, "cust_5xx"),
      ProvisionerError,
    );
    assertEquals(err.code, "LAGO_FETCH_FAILED");
  }),
);

Deno.test(
  "email belongs to admin → 409 EMAIL_BELONGS_TO_ADMIN",
  withMockedLago(
    {
      external_id: "cust_admin_collision",
      email: "admin@polaris.express",
      name: "Admin Person",
      firstname: null,
      lastname: null,
    },
    async () => {
      const store = newStore({
        users: [{
          id: "user_admin",
          email: "admin@polaris.express",
          role: "admin",
        }],
        lookupEmail: "admin@polaris.express",
        lookupLagoId: "cust_admin_collision",
      });
      const { tx, inserted } = createSmartTx(store);
      const err = await assertRejects(
        () => resolveOrCreateCustomerAccount(tx, "cust_admin_collision"),
        ProvisionerError,
      );
      assertEquals(err.code, "EMAIL_BELONGS_TO_ADMIN");
      assertEquals(inserted.length, 0);
    },
  ),
);

Deno.test(
  "email already linked to different Lago customer → 409",
  withMockedLago(
    {
      external_id: "cust_new",
      email: "carol@example.com",
      name: "Carol",
      firstname: null,
      lastname: null,
    },
    async () => {
      const otherUserId = "user_carol";
      const store = newStore({
        users: [{
          id: otherUserId,
          email: "carol@example.com",
          role: "customer",
        }],
        mappings: [
          // Carol is already linked to a DIFFERENT Lago customer
          {
            id: 1,
            userId: otherUserId,
            lagoCustomerExternalId: "cust_OTHER",
            createdAt: new Date(),
          },
        ],
        lookupEmail: "carol@example.com",
        lookupUserId: otherUserId,
        lookupLagoId: "cust_new",
      });
      const { tx, inserted } = createSmartTx(store);
      const err = await assertRejects(
        () => resolveOrCreateCustomerAccount(tx, "cust_new"),
        ProvisionerError,
      );
      assertEquals(err.code, "EMAIL_LINKED_TO_DIFFERENT_LAGO_CUSTOMER");
      assertEquals(inserted.length, 0);
    },
  ),
);

Deno.test(
  "idempotent re-link — existing customer email matches, no conflicting Lago id → reuse",
  withMockedLago(
    {
      external_id: "cust_relink",
      email: "dave@example.com",
      name: "Dave",
      firstname: null,
      lastname: null,
    },
    async () => {
      const userId = "user_dave";
      const store = newStore({
        users: [
          { id: userId, email: "dave@example.com", role: "customer" },
        ],
        mappings: [],
        lookupEmail: "dave@example.com",
        lookupUserId: userId,
        lookupLagoId: "cust_relink",
      });
      const { tx, inserted } = createSmartTx(store);
      const result = await resolveOrCreateCustomerAccount(tx, "cust_relink");
      assertEquals(result.created, false);
      assertEquals(result.reused, true);
      assertEquals(result.userId, userId);
      assertEquals(inserted.length, 0);
    },
  ),
);

Deno.test(
  "PG 23505 race during create → retry → reuse",
  withMockedLago(
    {
      external_id: "cust_race",
      email: "eve@example.com",
      name: "Eve",
      firstname: null,
      lastname: null,
    },
    async () => {
      // Simulate a concurrent insert: the resolver's email lookup returns
      // empty, the INSERT throws 23505, then on retry the lookup finds the
      // user that the racing transaction created.
      const userIdRacingInserted = "user_eve_concurrent";
      let firstLookupDone = false;
      const store = newStore({
        raceOnNextInsert: true,
        lookupEmail: "eve@example.com",
        lookupLagoId: "cust_race",
      });
      const realFind = store.users.find.bind(store.users);
      // Reset the find to inject a row before the SECOND user lookup.
      store.users.find = ((predicate: (u: FakeUserRow) => boolean) => {
        if (
          firstLookupDone &&
          !store.users.some((u) => u.id === userIdRacingInserted)
        ) {
          store.users.push({
            id: userIdRacingInserted,
            email: "eve@example.com",
            role: "customer",
          });
        }
        firstLookupDone = true;
        return realFind(predicate);
      }) as typeof store.users.find;

      const { tx } = createSmartTx(store);
      const result = await resolveOrCreateCustomerAccount(tx, "cust_race");
      assertEquals(result.created, false);
      assertEquals(result.reused, true);
      assertEquals(result.userId, userIdRacingInserted);
    },
  ),
);

Deno.test(
  "case-insensitive email lookup — existing user with different-case email is found",
  withMockedLago(
    {
      external_id: "cust_case",
      email: "Frank@Example.COM",
      name: "Frank",
      firstname: null,
      lastname: null,
    },
    async () => {
      const userId = "user_frank";
      const store = newStore({
        users: [
          { id: userId, email: "frank@example.com", role: "customer" },
        ],
        mappings: [],
        lookupEmail: "Frank@Example.COM",
        lookupUserId: userId,
        lookupLagoId: "cust_case",
      });
      const { tx, inserted } = createSmartTx(store);
      const result = await resolveOrCreateCustomerAccount(tx, "cust_case");
      assertEquals(result.reused, true);
      assertEquals(result.userId, userId);
      assertEquals(inserted.length, 0);
      assert(result.email?.toLowerCase() === "frank@example.com");
    },
  ),
);

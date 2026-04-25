/**
 * Customer Account Provisioner (Polaris Track A — Lifecycle)
 *
 * Pure-DB resolver that, given a Lago customer external ID, returns the user
 * account that owns that customer in our portal. Either reuses an existing
 * account or creates one silently. Never sends emails. Never goes through
 * Better-Auth's signUp API (which lacks transaction-aware adapters).
 *
 * Decision tree (per the plan, "Customer account lifecycle"):
 *
 *   1. Sibling lookup: any other user_mappings rows with the same
 *      lago_customer_external_id and a non-null user_id?
 *        - 1 distinct user_id → reuse it
 *        - >1 distinct user_ids → data integrity violation; pick the most
 *          recent and surface as a warning (the trigger from migration 0026
 *          should make this impossible going forward)
 *        - 0 → continue
 *   2. Fetch Lago customer (read-only inside tx)
 *   3. Validate customer.email (non-null, non-malformed)
 *   4. Email lookup (case-insensitive, per migration 0027 functional unique
 *      index):
 *        - no row → create the user
 *        - existing customer not yet linked elsewhere → reuse it
 *        - existing customer already linked to a DIFFERENT lago customer →
 *          REJECT 409 (data movement requires admin confirmation via PUT
 *          ?confirm_reassign=true at the route layer, which calls this
 *          resolver again with the new ID)
 *        - existing admin → REJECT 409 (admin and customer accounts must use
 *          different emails — write audit log)
 *   5. Create the user. PG 23505 race guard: re-do step 4 once before
 *      surfacing as 500.
 *
 * Throws ProvisionerError with `status` ∈ {409, 422, 502} on rejection. The
 * caller is expected to translate the status into an HTTP response body.
 *
 * NO emails sent. NO magic link issued. NO welcome flow. The customer claims
 * access by entering their email at /login at any time.
 */

import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db as _db } from "../db/index.ts";
import { userMappings, users } from "../db/schema.ts";
import { lagoClient } from "../lib/lago-client.ts";
import { logger } from "../lib/utils/logger.ts";
import {
  logCustomerAccountAutoCreateBlockedAdminEmail,
  logCustomerAccountAutoProvisioned,
} from "../lib/audit.ts";

const log = logger.child("CustomerAccountProvisioner");

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

/**
 * Resolution outcome returned to the caller.
 *
 * `created`: a brand-new users row was inserted in this resolver call.
 * `reused`: an existing users row was found (either via sibling lookup or
 * email-based reuse) and reused.
 * Both flags are mutually exclusive — exactly one is true.
 */
export interface ResolveCustomerAccountResult {
  userId: string;
  created: boolean;
  reused: boolean;
  /**
   * Account email. Null when the Lago customer had no email at provisioning
   * time — that's allowed; magic-link / outbound-email flows skip these
   * accounts silently and the customer signs in via scan-to-login.
   */
  email: string | null;
}

/**
 * Drizzle transaction handle. We accept the ambient db type rather than
 * importing a Drizzle-internal TX type directly so this module stays
 * maintainable across drizzle minor bumps. Both top-level `db` and the
 * argument passed to `db.transaction(async tx => ...)` satisfy this shape.
 */
// deno-lint-ignore no-explicit-any
export type DrizzleTx = any;

/** Reasons the resolver can reject a request. */
export type ProvisionerErrorCode =
  | "LAGO_CUSTOMER_NOT_FOUND" // 422
  | "LAGO_FETCH_FAILED" // 502
  | "LAGO_EMAIL_MISSING" // 422
  | "LAGO_EMAIL_MALFORMED" // 422
  | "EMAIL_BELONGS_TO_ADMIN" // 409
  | "EMAIL_LINKED_TO_DIFFERENT_LAGO_CUSTOMER"; // 409

const STATUS_BY_CODE: Record<ProvisionerErrorCode, number> = {
  LAGO_CUSTOMER_NOT_FOUND: 422,
  LAGO_FETCH_FAILED: 502,
  LAGO_EMAIL_MISSING: 422,
  LAGO_EMAIL_MALFORMED: 422,
  EMAIL_BELONGS_TO_ADMIN: 409,
  EMAIL_LINKED_TO_DIFFERENT_LAGO_CUSTOMER: 409,
};

/** Thrown when the resolver cannot proceed. */
export class ProvisionerError extends Error {
  readonly status: number;
  readonly code: ProvisionerErrorCode;
  constructor(code: ProvisionerErrorCode, message: string) {
    super(message);
    this.name = "ProvisionerError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isMalformedEmail(email: string): boolean {
  return !EMAIL_RE.test(email.trim());
}

function generateUserId(): string {
  return crypto.randomUUID();
}

function buildDisplayName(input: {
  name: string | null;
  firstname: string | null;
  lastname: string | null;
  /** Null when the Lago customer has no email — see resolveOrCreate. */
  email: string | null;
}): string | null {
  if (input.name && input.name.trim()) return input.name.trim();
  const composed = [input.firstname, input.lastname]
    .filter((p): p is string => !!p && !!p.trim())
    .map((p) => p.trim())
    .join(" ");
  if (composed) return composed;
  if (input.email) {
    // Strip the local-part so the name slot is non-empty.
    const local = input.email.split("@")[0] ?? "";
    return local || input.email;
  }
  // No name + no email — leave the column null. UI fallbacks already
  // handle null name (e.g. UserAvatarMenu's "Guest" / initials helper).
  return null;
}

/**
 * Find an existing customer account for this Lago customer via the sibling
 * mappings. `0` rows is the common case (admin is creating the very first
 * mapping for this Lago customer); `1` row is the idempotent re-link case;
 * `>1` distinct user_ids is a data-integrity violation.
 */
async function findExistingUserViaSibling(
  tx: DrizzleTx,
  lagoCustomerExternalId: string,
): Promise<{ userId: string | null; warning?: string }> {
  const rows = await tx
    .selectDistinct({ userId: userMappings.userId })
    .from(userMappings)
    .where(
      and(
        eq(userMappings.lagoCustomerExternalId, lagoCustomerExternalId),
        isNotNull(userMappings.userId),
      ),
    );
  if (rows.length === 0) return { userId: null };
  if (rows.length === 1) return { userId: rows[0].userId as string };
  // >1 distinct user ids — pick the most recent mapping's user_id and warn.
  // The trigger from migration 0026 prevents new INSERTs from creating this
  // state; the only way to land here is legacy data or manual SQL fixes.
  log.error("Multiple user_ids reference the same lago_customer", {
    lagoCustomerExternalId,
    userIds: rows.map((r: { userId: string | null }) => r.userId),
  });
  // Pick the one tied to the most recent mapping row.
  const mostRecent = await tx
    .select({ userId: userMappings.userId })
    .from(userMappings)
    .where(
      and(
        eq(userMappings.lagoCustomerExternalId, lagoCustomerExternalId),
        isNotNull(userMappings.userId),
      ),
    )
    .orderBy(sql`${userMappings.createdAt} DESC NULLS LAST`)
    .limit(1);
  return {
    userId: mostRecent[0]?.userId as string,
    warning:
      `Multiple user_ids reference lago_customer ${lagoCustomerExternalId}; using most recent.`,
  };
}

/**
 * Email-based lookup against `users`. Uses the case-insensitive functional
 * unique index from migration 0027 (LOWER(email) is unique).
 */
async function findExistingUserByEmail(
  tx: DrizzleTx,
  email: string,
): Promise<{ id: string; role: string; email: string } | null> {
  const rows = await tx
    .select({ id: users.id, role: users.role, email: users.email })
    .from(users)
    .where(sql`LOWER(${users.email}) = LOWER(${email})`)
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Is this customer user already linked to a different lago_customer? Used to
 * detect the "EMAIL_LINKED_TO_DIFFERENT_LAGO_CUSTOMER" 409 case during step 5
 * of the decision tree. Returns the conflicting lago id (so the response
 * body can include it) or null when no conflict exists.
 */
async function findConflictingLagoLink(
  tx: DrizzleTx,
  userId: string,
  lagoCustomerExternalId: string,
): Promise<string | null> {
  const rows = await tx
    .select({ lagoId: userMappings.lagoCustomerExternalId })
    .from(userMappings)
    .where(
      and(
        eq(userMappings.userId, userId),
        isNotNull(userMappings.lagoCustomerExternalId),
        ne(userMappings.lagoCustomerExternalId, lagoCustomerExternalId),
      ),
    )
    .limit(1);
  return (rows[0]?.lagoId as string | null) ?? null;
}

/**
 * Catch-and-narrow for PG 23505 (unique_violation). Drizzle/postgres-js
 * surfaces this as an Error with a `code` field; we read it defensively.
 */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const candidate = err as { code?: unknown; message?: unknown };
  if (candidate.code === "23505") return true;
  if (
    typeof candidate.message === "string" &&
    candidate.message.includes("23505")
  ) {
    return true;
  }
  return false;
}

/**
 * Map Lago client errors to ProvisionerError codes. Lago's HTTP errors
 * surface here as Error instances with the status in the message — we
 * pattern-match defensively rather than relying on a strict type because
 * `lagoClient` doesn't currently expose a discriminated error.
 */
function classifyLagoFetchError(err: unknown): ProvisionerError {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("404")) {
    return new ProvisionerError(
      "LAGO_CUSTOMER_NOT_FOUND",
      `Lago customer not found: ${msg}`,
    );
  }
  return new ProvisionerError(
    "LAGO_FETCH_FAILED",
    `Failed to fetch Lago customer: ${msg}`,
  );
}

// ----------------------------------------------------------------------------
// Public entry point
// ----------------------------------------------------------------------------

/**
 * Resolve or create the customer account for a Lago customer.
 *
 * Caller MUST pass a transaction handle (`tx`) — this resolver assumes a
 * write context so concurrent admin clicks racing on the same lago customer
 * serialise via the wrapping transaction.
 *
 * Returns the resolved user id plus context flags. Throws ProvisionerError
 * for the 4xx/5xx cases the caller is expected to translate into HTTP
 * responses.
 */
export async function resolveOrCreateCustomerAccount(
  tx: DrizzleTx,
  lagoCustomerExternalId: string,
): Promise<ResolveCustomerAccountResult> {
  // 0. Direct link lookup (migration 0030). `users.lago_customer_external_id`
  //    is the canonical idempotency key — if a user was previously
  //    provisioned for this Lago customer we reuse it unconditionally,
  //    regardless of whether any mappings exist yet. Without this, the
  //    no-email branch would INSERT a fresh row every reconcile pass.
  const [directLinked] = await tx
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.lagoCustomerExternalId, lagoCustomerExternalId))
    .limit(1);
  if (directLinked) {
    return {
      userId: directLinked.id,
      created: false,
      reused: true,
      email: directLinked.email,
    };
  }

  // 1. Sibling lookup — most common path is "admin previously linked a
  //    different mapping for the same Lago customer; reuse the same user".
  const sibling = await findExistingUserViaSibling(
    tx,
    lagoCustomerExternalId,
  );
  if (sibling.userId) {
    if (sibling.warning) log.warn(sibling.warning);
    const [existing] = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, sibling.userId))
      .limit(1);
    if (existing) {
      // Backfill the direct link so future lookups short-circuit at step 0.
      await tx
        .update(users)
        .set({ lagoCustomerExternalId })
        .where(
          and(
            eq(users.id, sibling.userId),
            isNull(users.lagoCustomerExternalId),
          ),
        );
      log.debug("Reused existing user via sibling lookup", {
        lagoCustomerExternalId,
        userId: sibling.userId,
      });
      return {
        userId: sibling.userId,
        created: false,
        reused: true,
        email: existing.email as string,
      };
    }
    // Sibling pointed at a user_id that no longer exists (deleted user).
    // Treat this like "no sibling" and continue to the Lago + email path so
    // the resolver can still produce a valid account.
    log.warn("Sibling user_id missing from users table; falling through", {
      lagoCustomerExternalId,
      userId: sibling.userId,
    });
  }

  // 2. Fetch the Lago customer for canonical email + name.
  let customer:
    | {
      external_id: string;
      email: string | null;
      name: string | null;
      firstname: string | null;
      lastname: string | null;
    }
    | null = null;
  try {
    const fetched = await lagoClient.getCustomer(lagoCustomerExternalId);
    customer = fetched.customer;
  } catch (err) {
    throw classifyLagoFetchError(err);
  }

  // 3. Validate the email — but tolerate absence.
  // Lago customers MAY have no email (manual onboarding, partial records,
  // legacy data). Those still get a `users` row with `email = NULL` so
  // scan-to-login still works; magic-link / outbound-email flows just
  // skip them silently (`hasUsableEmail` in `src/lib/email.ts`).
  // Malformed-but-present emails are still a hard rejection — the data is
  // wrong, admin should fix it in Lago.
  let emailRaw: string | null = null;
  if (customer.email && customer.email.trim()) {
    emailRaw = customer.email.trim();
    if (isMalformedEmail(emailRaw)) {
      throw new ProvisionerError(
        "LAGO_EMAIL_MALFORMED",
        `Lago customer email is malformed: ${emailRaw}`,
      );
    }
  }

  // 4. Email-based lookup (case-insensitive). When email is null we skip
  //    the lookup branch entirely and create with email=NULL — there's
  //    no possibility of an admin-collision or Lago-cross-link in that
  //    case because uniqueness/lookup are both keyed on email.
  if (emailRaw === null) {
    return await createNoEmailUser(tx, lagoCustomerExternalId, customer);
  }
  return await resolveOrCreateForEmail(
    tx,
    lagoCustomerExternalId,
    emailRaw,
    customer,
  );
}

/**
 * Direct insert path for the no-email branch. No lookup needed — there
 * are no email-keyed identities to collide with. The functional unique
 * index `users_email_lower_unique` (migration 0027) already permits
 * multiple NULL values (Postgres treats NULLs as distinct in indexes).
 */
async function createNoEmailUser(
  tx: DrizzleTx,
  lagoCustomerExternalId: string,
  customer: {
    name: string | null;
    firstname: string | null;
    lastname: string | null;
  },
): Promise<ResolveCustomerAccountResult> {
  const userId = generateUserId();
  const displayName = buildDisplayName({ ...customer, email: null });
  let inserted: { id: string; email: string | null };
  try {
    [inserted] = await tx
      .insert(users)
      .values({
        id: userId,
        email: null,
        name: displayName,
        role: "customer",
        emailVerified: false,
        lagoCustomerExternalId,
      })
      .returning({ id: users.id, email: users.email });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Another tx just inserted for this external_id — reuse it.
    const [raced] = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.lagoCustomerExternalId, lagoCustomerExternalId))
      .limit(1);
    if (!raced) throw err;
    return {
      userId: raced.id,
      created: false,
      reused: true,
      email: raced.email,
    };
  }
  await logCustomerAccountAutoProvisioned({
    userId: inserted.id,
    email: null,
    metadata: { lagoCustomerExternalId, noEmail: true },
  });
  log.info("Auto-provisioned customer account (no email)", {
    userId: inserted.id,
    lagoCustomerExternalId,
  });
  return {
    userId: inserted.id,
    created: true,
    reused: false,
    email: inserted.email,
  };
}

/**
 * The "have email, decide if user exists or needs creation" branch. Split
 * out so the PG 23505 race retry can call it directly without re-running the
 * sibling lookup or the Lago fetch.
 */
async function resolveOrCreateForEmail(
  tx: DrizzleTx,
  lagoCustomerExternalId: string,
  email: string,
  customer: {
    name: string | null;
    firstname: string | null;
    lastname: string | null;
  },
): Promise<ResolveCustomerAccountResult> {
  const existing = await findExistingUserByEmail(tx, email);
  if (existing) {
    if (existing.role === "admin") {
      // Don't auto-link an admin to a Lago customer. Audit it loudly so the
      // operator notices. The helper swallows DB errors so awaiting it is
      // safe even when audit table is unavailable.
      await logCustomerAccountAutoCreateBlockedAdminEmail({
        userId: existing.id,
        email,
        metadata: { lagoCustomerExternalId },
      });
      throw new ProvisionerError(
        "EMAIL_BELONGS_TO_ADMIN",
        "Email belongs to an admin account; admin and customer accounts must use different emails.",
      );
    }
    // Customer found — make sure it isn't already linked to a different
    // Lago customer.
    const conflictingLagoId = await findConflictingLagoLink(
      tx,
      existing.id,
      lagoCustomerExternalId,
    );
    if (conflictingLagoId) {
      throw new ProvisionerError(
        "EMAIL_LINKED_TO_DIFFERENT_LAGO_CUSTOMER",
        `Email ${email} is already linked to Lago customer ${conflictingLagoId}.`,
      );
    }
    await tx
      .update(users)
      .set({ lagoCustomerExternalId })
      .where(
        and(
          eq(users.id, existing.id),
          isNull(users.lagoCustomerExternalId),
        ),
      );
    log.info("Reusing existing customer account by email", {
      userId: existing.id,
      email,
      lagoCustomerExternalId,
    });
    return {
      userId: existing.id,
      created: false,
      reused: true,
      email: existing.email,
    };
  }

  // 5. Create. Race guard catches PG 23505 (unique_violation on
  //    users_email_lower_unique) and re-runs the email lookup once.
  return await createUserWithRaceRetry(
    tx,
    lagoCustomerExternalId,
    email,
    customer,
  );
}

async function createUserWithRaceRetry(
  tx: DrizzleTx,
  lagoCustomerExternalId: string,
  email: string,
  customer: {
    name: string | null;
    firstname: string | null;
    lastname: string | null;
  },
): Promise<ResolveCustomerAccountResult> {
  const userId = generateUserId();
  const displayName = buildDisplayName({ ...customer, email });
  try {
    const [inserted] = await tx
      .insert(users)
      .values({
        id: userId,
        email,
        name: displayName,
        role: "customer",
        emailVerified: false,
        lagoCustomerExternalId,
      })
      .returning({ id: users.id, email: users.email });
    await logCustomerAccountAutoProvisioned({
      userId: inserted.id,
      email,
      metadata: { lagoCustomerExternalId },
    });
    log.info("Auto-provisioned customer account", {
      userId: inserted.id,
      email,
      lagoCustomerExternalId,
    });
    return {
      userId: inserted.id,
      created: true,
      reused: false,
      email: inserted.email,
    };
  } catch (err) {
    if (!isUniqueViolation(err)) {
      throw err;
    }
    // PG 23505: another transaction inserted the same email or direct-link
    // between our SELECT and our INSERT. Re-do both lookups once. If THAT
    // also fails the happy path we surface as 500 (something is very wrong).
    log.warn("Race detected creating user; retrying lookup once", {
      email,
      lagoCustomerExternalId,
    });
    const [directLinked] = await tx
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.lagoCustomerExternalId, lagoCustomerExternalId))
      .limit(1);
    if (directLinked) {
      return {
        userId: directLinked.id,
        created: false,
        reused: true,
        email: directLinked.email,
      };
    }
    const retried = await findExistingUserByEmail(tx, email);
    if (!retried) {
      throw err;
    }
    if (retried.role === "admin") {
      await logCustomerAccountAutoCreateBlockedAdminEmail({
        userId: retried.id,
        email,
        metadata: { lagoCustomerExternalId },
      });
      throw new ProvisionerError(
        "EMAIL_BELONGS_TO_ADMIN",
        "Email belongs to an admin account; admin and customer accounts must use different emails.",
      );
    }
    const conflictingLagoId = await findConflictingLagoLink(
      tx,
      retried.id,
      lagoCustomerExternalId,
    );
    if (conflictingLagoId) {
      throw new ProvisionerError(
        "EMAIL_LINKED_TO_DIFFERENT_LAGO_CUSTOMER",
        `Email ${email} is already linked to Lago customer ${conflictingLagoId}.`,
      );
    }
    return {
      userId: retried.id,
      created: false,
      reused: true,
      email: retried.email,
    };
  }
}

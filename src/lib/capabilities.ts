/**
 * Polaris Track A — customer capability gating.
 *
 * One role + dynamic capability check. The plan rejected adding a third role
 * (`customer_inactive`) because:
 *   - It collides with the migration-0019 CHECK constraint.
 *   - It requires session re-issue on every state transition.
 *   - It complicates the trigger from migration 0018.
 *
 * Instead: keep `role='customer'` for everyone, and derive what they can DO
 * at request time from the presence of an active mapping.
 *
 * Usage in a customer-facing handler:
 *
 *   import { assertCapability } from "@/src/lib/capabilities.ts";
 *   await assertCapability(ctx, "start_charge");
 *   // ...handler proceeds knowing scope is active
 *
 * `assertCapability` throws `CapabilityDeniedError` (status 403) on miss.
 * Capability denial is logged to `auth_audit` so forensics can reconstruct
 * which routes a soft-deactivated customer attempted.
 */

import type { FreshContext } from "fresh";
import { resolveCustomerScope, type ScopingContext } from "./scoping.ts";
import { logCapabilityDenied } from "./audit.ts";
import type { State } from "@/utils.ts";

/** Granular capabilities a customer can possess. */
export type CustomerCapability =
  | "view_history"
  | "start_charge"
  | "stop_charge"
  | "reserve"
  | "manage_cards";

/** Full capabilities granted to active customers. */
const FULL: ReadonlySet<CustomerCapability> = new Set<CustomerCapability>([
  "view_history",
  "start_charge",
  "stop_charge",
  "reserve",
  "manage_cards",
]);

/** Capabilities granted to customers with no active mappings. */
const READ_ONLY: ReadonlySet<CustomerCapability> = new Set<CustomerCapability>(
  ["view_history"],
);

/**
 * Extension to ScopingContext to memoize capabilities on the request state.
 * Stored alongside the resolved scope to avoid recomputing the set on each
 * call.
 */
type CapabilityState = State & {
  customerCaps?: ReadonlySet<CustomerCapability>;
};

/**
 * Resolve and memoize the active customer's capability set for this request.
 *
 * Reads `scope.isActive` from `resolveCustomerScope(ctx)` (already memoized).
 * Returns the canonical FULL set when isActive=true, READ_ONLY when not.
 *
 * Memoization layers:
 *   - `ctx.state.customerCaps` (if previously computed in this request)
 *   - `ctx.state.customerScope` (via `resolveCustomerScope`)
 *
 * Both layers prevent duplicate work on chained handlers (e.g. layout +
 * route + island prop builder all calling this in one render).
 */
export async function getCustomerCapabilities(
  ctx: ScopingContext | FreshContext<State>,
): Promise<ReadonlySet<CustomerCapability>> {
  const state = ctx.state as CapabilityState;
  if (state.customerCaps) return state.customerCaps;
  const scope = await resolveCustomerScope(ctx);
  const caps = scope.isActive ? FULL : READ_ONLY;
  state.customerCaps = caps;
  return caps;
}

/**
 * Thrown when a handler asserts a capability that the caller doesn't have.
 *
 * `status = 403` is the wire status (capabilities are about what an
 * authenticated user is allowed to do, not who they are; 401 is for missing
 * auth). Routes typically translate this into a JSON error body with the
 * denied capability so the customer UI can render the right "Account inactive"
 * affordance.
 */
export class CapabilityDeniedError extends Error {
  readonly status = 403;
  constructor(public capability: CustomerCapability) {
    super(`Capability denied: ${capability}`);
    this.name = "CapabilityDeniedError";
  }
}

/**
 * Throw `CapabilityDeniedError` when the current scope can't perform
 * `capability`. Logs `capability.denied` to `auth_audit` on rejection so the
 * forensics pipeline can correlate denied attempts to routes/sessions.
 *
 * Best-effort audit: the underlying logger swallows DB errors so a missing
 * audit table never breaks the rejection path.
 */
export async function assertCapability(
  ctx: ScopingContext | FreshContext<State>,
  capability: CustomerCapability,
): Promise<void> {
  const caps = await getCustomerCapabilities(ctx);
  if (caps.has(capability)) return;

  const state = ctx.state as State;
  const userId = state.user?.id ?? state.actingAs ?? null;
  // `route` is best-effort — Fresh contexts include a request URL we can pull
  // the pathname from. ScopingContext (used in unit tests) won't have it.
  let route: string | null = null;
  try {
    const maybeReq = (ctx as { req?: Request }).req;
    if (maybeReq) {
      const url = new URL(maybeReq.url);
      route = url.pathname;
    }
  } catch {
    // ignore — route is metadata, not load-bearing
  }
  await logCapabilityDenied({
    userId,
    route,
    metadata: { capability },
  });
  throw new CapabilityDeniedError(capability);
}

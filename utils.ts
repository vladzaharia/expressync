import { createDefine } from "fresh";

/**
 * Polaris Track A: which UI surface served this request.
 *
 *   admin    — manage.polaris.express (operator console). File-system path
 *              is rewritten to prepend `/admin` before Fresh dispatches.
 *   customer — polaris.express (end-customer portal). No path rewrite.
 *
 * The middleware sets this on every request after hostname classification.
 */
export type Surface = "admin" | "customer";

/**
 * Polaris Track A: derived customer scope, memoized on `ctx.state.customerScope`
 * so handlers can pre-filter every Drizzle query without re-hitting user_mappings.
 *
 * `isActive` is true iff at least one mapping has `is_active=true`. Used to
 * gate capability checks (start/stop/reserve) for soft-unlinked customers.
 *
 * Defined here (rather than in scoping.ts) to avoid a circular import:
 * routes import State from `utils.ts`, and `utils.ts` should not pull
 * scoping.ts into the type graph at the entry point.
 */
export interface CustomerScope {
  /** Lago `external_customer_id` for this user — null if no Lago link. */
  lagoCustomerExternalId: string | null;
  /** All StEvE OCPP tag PKs the user owns (active and inactive). */
  ocppTagPks: number[];
  /** All `user_mappings.id` rows owned by the user (active and inactive). */
  mappingIds: number[];
  /** True iff at least one owned mapping has `is_active=true`. */
  isActive: boolean;
}

// This specifies the type of "ctx.state" which is used to share
// data among middlewares, layouts and routes.
export interface State {
  // BetterAuth types these with slightly different optionality (e.g. `name: string`
  // without null, `image?: string | null | undefined`). We accept the broader
  // shape and let consumers coerce when they need strict nullability.
  user?: {
    id: string;
    name: string | null | undefined;
    email: string;
    emailVerified: boolean;
    image?: string | null | undefined;
    role: string;
    createdAt: Date;
    updatedAt: Date;
  };
  session?: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date;
    ipAddress?: string | null | undefined;
    userAgent?: string | null | undefined;
    createdAt: Date;
    updatedAt: Date;
  };

  /**
   * Polaris Track A: which surface this request was routed to (set by the
   * hostname dispatch in `_middleware.ts`). Consumers (layout, nav, theme
   * defaults) should branch on this rather than re-parsing the hostname.
   */
  surface?: Surface;

  /**
   * Polaris Track A: when an admin accesses customer-surface endpoints with
   * `?as=<customerUserId>`, this is the impersonated customer's user_id.
   * Ownership scoping helpers read `actingAs ?? user.id`. Mutating endpoints
   * MUST reject when `actingAs` is set (read-only impersonation in MVP).
   */
  actingAs?: string;

  /**
   * Polaris Track A: memoized customer scope. Populated lazily by
   * `resolveCustomerScope()` in `src/lib/scoping.ts` so multiple handlers in
   * the same request reuse the cached value rather than re-querying
   * user_mappings. Use `resolveCustomerScope(ctx)` instead of touching
   * this directly.
   */
  customerScope?: CustomerScope;

  /**
   * ExpresScan / Wave 1 Track A: bearer-authenticated device context.
   *
   * Set by the bearer-auth branch in `_middleware.ts` when a valid
   * `Authorization: Bearer dev_…` header resolves to a live device + token
   * row. `device` and `user` are mutually exclusive — bearer auth NEVER
   * populates `user`, and cookie auth NEVER populates `device`.
   */
  device?: {
    /** UUID of the matched device row. */
    id: string;
    /** Owner admin user_id. The trigger guarantees role='admin'. */
    ownerUserId: string;
    /** Granted capabilities ("tap", "ev", ...). */
    capabilities: string[];
    /** sha256 of the device's HMAC secret — used by scan-result for nonce verify. */
    secretHash: string;
    /** UUID of the active `device_tokens` row. Used for revocation events. */
    tokenId: string;
  };
}

export const define = createDefine<State>();

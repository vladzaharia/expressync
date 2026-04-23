/**
 * POST /api/customer/delete-account
 *
 * MVP: returns 501 Not Implemented.
 *
 * The full self-serve delete flow requires:
 *   - `users.deleted_at` column (NOT in current migrations 0017–0027)
 *   - Tombstone email rewrite + email-uniqueness reconciliation
 *   - Bulk session revocation (sessions table cascades on user delete; we'd
 *     instead want a soft-delete that keeps the row + nulls the email)
 *   - Decision on `user_mappings.user_id` retention vs. nulling
 *
 * Until those land, the customer "Delete account" affordance should display
 * an informational dialog directing them to contact the operator. The route
 * exists so the front-end can fail loudly + the backend can attach a real
 * implementation in one place when the schema work lands.
 */

import { define } from "../../../utils.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = define.handlers({
  POST(ctx) {
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    return jsonResponse(501, {
      error:
        "Self-serve account deletion is not yet available. Please contact your operator.",
      detail:
        "Schema work (users.deleted_at + tombstone email) is tracked in a follow-up.",
    });
  },
  DELETE(ctx) {
    // Accept DELETE for symmetry with the /profile DELETE convention; same
    // deferred behavior.
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    return jsonResponse(501, {
      error:
        "Self-serve account deletion is not yet available. Please contact your operator.",
    });
  },
});

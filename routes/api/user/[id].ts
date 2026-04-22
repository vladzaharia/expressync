import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { users } from "../../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { logger } from "../../../src/lib/utils/logger.ts";

export const handler = define.handlers({
  /**
   * PUT /api/user/:id - Update user role (admin only)
   */
  async PUT(ctx) {
    try {
      const userId = ctx.params.id;
      const body = await ctx.req.json();
      const { role } = body;

      const validRoles = ["admin", "customer"];
      if (!role || !validRoles.includes(role)) {
        return new Response(
          JSON.stringify({
            error: "role is required and must be 'admin' or 'customer'",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      // Prevent user from changing their own role
      if (userId === ctx.state.user?.id) {
        return new Response(
          JSON.stringify({ error: "Cannot change your own role" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const [updated] = await db
        .update(users)
        .set({ role, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
        });

      if (!updated) {
        return new Response(
          JSON.stringify({ error: "User not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify(updated), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      logger.error("API", "Failed to update user", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to update user" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },

  /**
   * DELETE /api/user/:id - Delete user (admin only)
   * Cascade will handle sessions/accounts cleanup.
   */
  async DELETE(ctx) {
    try {
      const userId = ctx.params.id;

      // Prevent user from deleting themselves
      if (userId === ctx.state.user?.id) {
        return new Response(
          JSON.stringify({ error: "Cannot delete your own account" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const [deleted] = await db
        .delete(users)
        .where(eq(users.id, userId))
        .returning({ id: users.id });

      if (!deleted) {
        return new Response(
          JSON.stringify({ error: "User not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ success: true, id: deleted.id }),
        { headers: { "Content-Type": "application/json" } },
      );
    } catch (error) {
      logger.error("API", "Failed to delete user", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to delete user" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});

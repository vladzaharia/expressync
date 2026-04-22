import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import { users } from "../../../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { auth } from "../../../../src/lib/auth.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

export const handler = define.handlers({
  /**
   * GET /api/user - List all users (admin only)
   */
  async GET(_ctx) {
    try {
      const allUsers = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          createdAt: users.createdAt,
        })
        .from(users);

      return new Response(JSON.stringify(allUsers), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      logger.error("API", "Failed to fetch users", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch users" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },

  /**
   * POST /api/user - Create a new user (admin only)
   * Uses BetterAuth's signUpEmail internally since public sign-up is disabled.
   */
  async POST(ctx) {
    try {
      const body = await ctx.req.json();
      const { email, password, name, role } = body;

      if (!email || !password || !name) {
        return new Response(
          JSON.stringify({
            error: "email, password, and name are required",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return new Response(
          JSON.stringify({ error: "Invalid email format" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      if (name.length > 200) {
        return new Response(
          JSON.stringify({ error: "Name must be 200 characters or less" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      if (password.length < 12) {
        return new Response(
          JSON.stringify({
            error: "Password must be at least 12 characters",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const validRoles = ["admin", "customer"];
      const userRole = validRoles.includes(role) ? role : "admin";

      // Use BetterAuth's internal API to create the user
      // This bypasses the disableSignUp flag since it's server-side
      const result = await auth.api.signUpEmail({
        body: {
          email,
          password,
          name,
        },
      });

      if (!result?.user?.id) {
        return new Response(
          JSON.stringify({ error: "Failed to create user" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }

      // Update the role if it's not the default "admin"
      if (userRole !== "admin") {
        await db
          .update(users)
          .set({ role: userRole })
          .where(eq(users.id, result.user.id));
      }

      return new Response(
        JSON.stringify({
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: userRole,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    } catch (error) {
      logger.error("API", "Failed to create user", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to create user" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});

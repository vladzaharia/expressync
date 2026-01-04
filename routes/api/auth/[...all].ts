import { auth } from "../../../src/lib/auth.ts";
import { define } from "../../../utils.ts";

/**
 * Catch-all handler for BetterAuth
 *
 * BetterAuth handles all /api/auth/* routes automatically:
 * - POST /api/auth/sign-up/email - Register new user
 * - POST /api/auth/sign-in/email - Login with email/password
 * - POST /api/auth/sign-out - Logout
 * - GET /api/auth/session - Get current session
 */
export const handler = define.handlers({
  GET: (ctx) => auth.handler(ctx.req),
  POST: (ctx) => auth.handler(ctx.req),
  PUT: (ctx) => auth.handler(ctx.req),
  DELETE: (ctx) => auth.handler(ctx.req),
  PATCH: (ctx) => auth.handler(ctx.req),
});

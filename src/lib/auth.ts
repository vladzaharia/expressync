import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import { config } from "./config.ts";

/**
 * BetterAuth instance
 *
 * Configured with:
 * - Drizzle adapter for PostgreSQL
 * - Email/password credentials
 * - Session-based auth with cookies
 */
export const auth = betterAuth({
  // Database adapter
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),

  // Secret for signing cookies/tokens
  secret: config.AUTH_SECRET,

  // Base URL for redirects
  baseURL: config.AUTH_URL,

  // Trusted origins for CORS (includes dev server)
  trustedOrigins: [
    config.AUTH_URL,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
  ],

  // Email & password authentication
  emailAndPassword: {
    enabled: true,
    // Require email verification before login (disabled for simplicity)
    requireEmailVerification: false,
  },

  // Session configuration
  session: {
    // Cookie name
    cookieName: "ev_billing_session",
    // Session expiry (30 days)
    expiresIn: 60 * 60 * 24 * 30,
    // Update session on each request (every 24 hours)
    updateAge: 60 * 60 * 24,
  },

  // Advanced options
  advanced: {
    // Use secure cookies in production
    useSecureCookies: config.AUTH_URL.startsWith("https"),
  },
});

/**
 * Type for the authenticated user
 */
export type AuthUser = typeof auth.$Infer.Session.user;

/**
 * Type for the session
 */
export type AuthSession = typeof auth.$Infer.Session.session;

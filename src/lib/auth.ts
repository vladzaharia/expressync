import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins/magic-link";
import { db } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import { config } from "./config.ts";
import { sendCustomerMagicLink } from "./email.ts";
import { hashEmail, logAuthEvent, logMagicLinkRequested } from "./audit.ts";
import { polarisCustomerSessionPlugin } from "./auth-helpers.ts";

/**
 * BetterAuth instance
 *
 * Configured with:
 * - Drizzle adapter for PostgreSQL
 * - Email/password credentials (admin path; disableSignUp:true)
 * - Magic-link plugin (customer path; disableSignUp:true)
 * - Polaris customer-session plugin (used by scan-to-login)
 * - Cross-subdomain cookies scoped to .polaris.express so admin
 *   (manage.polaris.express) and customer (polaris.express) share session.
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

  // Trusted origins for CORS / Origin checks
  // Both production hosts plus dev-mode loopback variants. Better-Auth
  // applies these as the allowlist for the Origin header on its endpoints.
  trustedOrigins: [
    config.AUTH_URL,
    "https://manage.polaris.express",
    "https://polaris.express",
    config.ADMIN_BASE_URL,
    ...(config.DENO_ENV === "development"
      ? [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://manage.polaris.localhost:5173",
        "http://polaris.localhost:5173",
      ]
      : []),
  ],

  // Email & password authentication (admin path).
  emailAndPassword: {
    enabled: true,
    // Disable public self-registration -- admins are created via seed script
    disableSignUp: true,
    minPasswordLength: 12,
    requireEmailVerification: false,
  },

  // Session configuration. Customers get a hard 8-hour ceiling enforced
  // separately by the middleware (see routes/_middleware.ts) — the
  // expiresIn here is the upper bound for admins.
  session: {
    cookieName: "ev_billing_session",
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh every 24h
  },

  // Cross-subdomain cookies so manage.polaris.express and polaris.express
  // share one session. Cookie Domain attribute is set to .polaris.express;
  // browsers send the cookie on either subdomain.
  advanced: {
    useSecureCookies: config.AUTH_URL.startsWith("https"),
    crossSubDomainCookies: {
      enabled: true,
      domain: config.COOKIE_DOMAIN,
    },
    cookies: {
      session_token: {
        attributes: {
          sameSite: "lax",
          domain: config.COOKIE_DOMAIN,
        },
      },
    },
  },

  /**
   * databaseHooks.user.create.before — defense in depth.
   *
   * Any user created via the magic-link signup path is forced to
   * role="customer". The plugin already has `disableSignUp: true` set,
   * but if a future admin enables signup or a different signup path is
   * added, this hook ensures we never accidentally create an admin
   * account through a customer-facing flow. Admin creation goes through
   * the dedicated admin user-management endpoints (or the seed script),
   * which sets role="admin" explicitly.
   */
  databaseHooks: {
    user: {
      create: {
        before: (user, ctx) => {
          if (ctx?.path === "/sign-in/magic-link") {
            return Promise.resolve({
              data: { ...user, role: "customer" },
            });
          }
          return Promise.resolve({ data: user });
        },
      },
    },
  },

  plugins: [
    /**
     * Magic-link plugin (customer path).
     *
     * Critical config:
     *   - disableSignUp: true       — anyone trying to sign in with an
     *                                  email NOT already in `users` gets
     *                                  rejected. Auto-provisioning happens
     *                                  via admin-side tag linking, NOT here.
     *   - storeToken: "hashed"      — the token is stored as a sha256 hash
     *                                  in `verifications.value`; the raw
     *                                  token only exists in the email body.
     *                                  Defense vs DB exfiltration.
     *   - expiresIn: 15 min         — short window. Customers click the
     *                                  link within minutes; longer windows
     *                                  invite token interception.
     */
    magicLink({
      disableSignUp: true,
      expiresIn: config.MAGIC_LINK_TTL_SECONDS,
      storeToken: "hashed",
      sendMagicLink: async ({ email, url, token }, _ctx) => {
        // Constant-time-ish jitter floor: a deterministic ~50-150ms wait
        // smooths out the difference between "user exists, send email" and
        // "user does not exist, return early". Without this, an attacker
        // can compare response latencies to enumerate registered emails.
        // We don't try to be cryptographically constant-time — just to mask
        // the bulk of the latency variance.
        const jitter = 50 + Math.floor(Math.random() * 100);
        const jitterPromise = new Promise<void>((resolve) =>
          setTimeout(resolve, jitter)
        );
        // Audit BEFORE sending so we always have the request record even if
        // the email Worker call rolls back.
        const tokenHash = await hashEmail(token); // sha256 helper, name kept for symmetry
        await logMagicLinkRequested({
          email,
          metadata: { tokenHash, urlHost: safeUrlHost(url) },
        });
        // sendCustomerMagicLink NEVER throws — it returns a SendEmailResult
        // capturing worker outages, missing config, render bugs, etc. We
        // audit the failure mode but don't propagate so Better-Auth still
        // returns a uniform success to the caller (anti-enumeration).
        const result = await sendCustomerMagicLink(email, url);
        if (!result.ok) {
          await logAuthEvent("magic_link.failed", {
            email,
            metadata: {
              reason: "email_transport_failure",
              status: result.status,
              detail: result.reason,
            },
          });
        }
        // Wait out the jitter floor so the response latency is roughly
        // independent of the actual send path taken.
        await jitterPromise;
      },
    }),

    /**
     * Polaris customer-session plugin — exposes
     * `auth.api.signInWithUserId` so the scan-to-login endpoint (Track C)
     * can mint a session for a verified customer without requiring a
     * password or magic-link round-trip. See `auth-helpers.ts` for the
     * implementation + security model.
     */
    polarisCustomerSessionPlugin(),
  ],
});

/**
 * Type for the authenticated user
 */
export type AuthUser = typeof auth.$Infer.Session.user;

/**
 * Type for the session
 */
export type AuthSession = typeof auth.$Infer.Session.session;

/** Internal: extract host from a URL string for audit metadata. */
function safeUrlHost(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return "";
  }
}

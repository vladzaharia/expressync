/**
 * GET / POST /auth/verify
 *
 * Polaris Track C — magic-link landing page (defeats email previewers).
 *
 * Outlook SafeLinks, Gmail proxy-fetch, and antivirus scanners issue
 * `GET` on links and burn single-use tokens before the user actually
 * clicks. The mitigation here:
 *
 *   - GET `/auth/verify?token=X&callbackURL=/` renders a form with a
 *     "Continue sign-in" button. Bots that don't run JS or don't POST
 *     forms cannot consume the token.
 *   - POST `/auth/verify` with the same token (form data) calls
 *     `auth.api.magicLinkVerify` server-side, which creates the session
 *     and returns Set-Cookie headers. We pass those through with a 302
 *     redirect to the callbackURL.
 *
 * This page lives at `polaris.express/auth/verify` (customer surface
 * only — the route classifier scopes it that way).
 */

import { define } from "../../utils.ts";
import { auth } from "../../src/lib/auth.ts";
import { logMagicLinkConsumed } from "../../src/lib/audit.ts";
import { logger } from "../../src/lib/utils/logger.ts";

const log = logger.child("AuthVerify");

interface VerifyData {
  token: string;
  callbackURL: string;
  error?: string;
}

function safeCallbackUrl(raw: string | null): string {
  // Only allow same-origin relative paths. If anything fishy, fall back
  // to "/" (customer dashboard).
  if (!raw) return "/";
  const trimmed = raw.trim();
  if (trimmed === "") return "/";
  if (!trimmed.startsWith("/")) return "/";
  if (trimmed.startsWith("//")) return "/"; // protocol-relative — denied
  // Disallow obvious injection attempts
  if (trimmed.includes("\n") || trimmed.includes("\r")) return "/";
  return trimmed;
}

export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    const token = url.searchParams.get("token") ?? "";
    const callbackURL = safeCallbackUrl(url.searchParams.get("callbackURL"));
    return {
      data: {
        token,
        callbackURL,
        error: url.searchParams.get("error") ?? undefined,
      } satisfies VerifyData,
    };
  },
  async POST(ctx) {
    let token = "";
    let callbackURL = "/";
    const ct = ctx.req.headers.get("content-type") ?? "";
    try {
      if (ct.includes("application/x-www-form-urlencoded")) {
        const form = await ctx.req.formData();
        token = String(form.get("token") ?? "").trim();
        callbackURL = safeCallbackUrl(String(form.get("callbackURL") ?? ""));
      } else if (ct.includes("application/json")) {
        const body = await ctx.req.json();
        token = String(body.token ?? "").trim();
        callbackURL = safeCallbackUrl(String(body.callbackURL ?? ""));
      } else {
        // Best-effort: try formData first, fall back to URLSearchParams.
        try {
          const form = await ctx.req.formData();
          token = String(form.get("token") ?? "").trim();
          callbackURL = safeCallbackUrl(
            String(form.get("callbackURL") ?? ""),
          );
        } catch {
          token = "";
        }
      }
    } catch (err) {
      log.warn("verify body parse failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (!token) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/auth/verify?error=missing_token" },
      });
    }

    // Better-Auth's magicLinkVerify is a GET endpoint; it inspects
    // ctx.query.token + ctx.query.callbackURL and either redirects on
    // success or throws ctx.redirect on error. We invoke it with
    // asResponse:true so we can fish out the Set-Cookie headers and
    // re-route the redirect through OUR callbackURL.
    try {
      // deno-lint-ignore no-explicit-any
      const api = auth.api as any;
      if (typeof api?.magicLinkVerify !== "function") {
        log.error("magicLinkVerify endpoint missing from auth.api");
        return new Response(null, {
          status: 302,
          headers: { Location: "/auth/verify?error=server_misconfig" },
        });
      }
      const verifyResp = await api.magicLinkVerify({
        query: { token, callbackURL },
        headers: ctx.req.headers,
        asResponse: true,
      });
      // The endpoint returns either a JSON response (200) or a redirect
      // response. In either case, success is signalled by status < 400.
      if (verifyResp instanceof Response) {
        if (verifyResp.status >= 400) {
          // Surface error in URL so the GET render can show it.
          return new Response(null, {
            status: 302,
            headers: { Location: "/auth/verify?error=invalid_or_expired" },
          });
        }
        // Build our redirect, copying through Set-Cookie.
        const out = new Response(null, {
          status: 302,
          headers: { Location: callbackURL },
        });
        for (const [k, v] of verifyResp.headers.entries()) {
          if (k.toLowerCase() === "set-cookie") {
            out.headers.append("Set-Cookie", v);
          }
        }
        // Best-effort audit (the underlying endpoint already deletes
        // the verification row; we just record the consume event).
        void logMagicLinkConsumed({
          ip: ctx.req.headers.get("x-forwarded-for") ??
            ctx.req.headers.get("x-real-ip") ??
            null,
          ua: ctx.req.headers.get("user-agent"),
          route: "/auth/verify",
          metadata: { source: "post_confirm" },
        });
        return out;
      }
      return new Response(null, {
        status: 302,
        headers: { Location: callbackURL },
      });
    } catch (err) {
      log.warn("magicLinkVerify threw", {
        error: err instanceof Error ? err.message : String(err),
      });
      return new Response(null, {
        status: 302,
        headers: { Location: "/auth/verify?error=invalid_or_expired" },
      });
    }
  },
});

export default define.page<typeof handler>(function VerifyPage({ data }) {
  const { token, callbackURL, error } = data;
  if (error) {
    return (
      <div class="min-h-screen flex items-center justify-center bg-background">
        <div class="w-full max-w-md p-6 rounded-lg border border-border bg-card">
          <h1 class="text-xl font-semibold mb-2">Sign-in link unusable</h1>
          <p class="text-sm text-muted-foreground mb-6">
            This sign-in link is invalid or has expired. Request a new one from
            the login page.
          </p>
          <a
            href="/login"
            class="inline-flex items-center justify-center w-full h-11 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 transition"
          >
            Back to sign-in
          </a>
        </div>
      </div>
    );
  }
  if (!token) {
    return (
      <div class="min-h-screen flex items-center justify-center bg-background">
        <div class="w-full max-w-md p-6 rounded-lg border border-border bg-card">
          <h1 class="text-xl font-semibold mb-2">Missing token</h1>
          <p class="text-sm text-muted-foreground mb-6">
            This page needs a sign-in token to proceed. Open the link from your
            email, or request a fresh one.
          </p>
          <a
            href="/login"
            class="inline-flex items-center justify-center w-full h-11 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 transition"
          >
            Back to sign-in
          </a>
        </div>
      </div>
    );
  }
  return (
    <div class="min-h-screen flex items-center justify-center bg-background">
      <div class="w-full max-w-md p-6 rounded-lg border border-border bg-card">
        <h1 class="text-xl font-semibold mb-2">Confirm sign-in</h1>
        <p class="text-sm text-muted-foreground mb-6">
          Click the button below to finish signing in to ExpressCharge.
        </p>
        <form method="POST" action="/auth/verify" class="space-y-3">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="callbackURL" value={callbackURL} />
          <button
            type="submit"
            class="inline-flex items-center justify-center w-full h-11 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 transition"
          >
            Continue
          </button>
        </form>
        <p class="text-xs text-muted-foreground mt-4 text-center">
          This extra step protects your account from automated link previewers
          in your email client.
        </p>
      </div>
    </div>
  );
});

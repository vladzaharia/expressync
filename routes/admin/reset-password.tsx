/**
 * GET /admin/reset-password?token=X
 *
 * Polaris Track C — admin password reset confirmation page.
 *
 * Lives at `manage.polaris.express/reset-password?token=X` (file path
 * is `routes/admin/reset-password.tsx` because the middleware rewrites
 * the admin host's URL to prefix `/admin/`).
 *
 * Behavior:
 *   - GET: render the `ResetPasswordForm` island with the token in
 *     props.
 *   - The island POSTs `/api/admin/reset-password` and follows the
 *     server's `redirectTo` (typically `/login`).
 *
 * If the token is missing from the URL, render an "Invalid link" screen
 * with a link back to `/login`.
 */

import { define } from "../../utils.ts";
import ResetPasswordForm from "../../islands/admin/ResetPasswordForm.tsx";

interface ResetPageData {
  token: string;
  error?: string;
}

export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    const token = url.searchParams.get("token") ?? "";
    return {
      data: {
        token,
        error: url.searchParams.get("error") ?? undefined,
      } satisfies ResetPageData,
    };
  },
});

export default define.page<typeof handler>(
  function ResetPasswordPage({ data }) {
    if (!data.token) {
      return (
        <div class="min-h-screen flex items-center justify-center bg-background">
          <div class="w-full max-w-md p-6 rounded-lg border border-border bg-card">
            <h1 class="text-xl font-semibold mb-2">Reset link unusable</h1>
            <p class="text-sm text-muted-foreground mb-6">
              This password-reset link is missing its token. Request a new one
              from the sign-in page.
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
          <h1 class="text-xl font-semibold mb-1">Set a new password</h1>
          <p class="text-sm text-muted-foreground mb-6">
            Choose a new password for your admin account.
          </p>
          {data.error
            ? (
              <p class="text-sm text-destructive mb-4">
                {humanize(data.error)}
              </p>
            )
            : null}
          <ResetPasswordForm token={data.token} />
        </div>
      </div>
    );
  },
);

function humanize(code: string): string {
  switch (code) {
    case "invalid_token":
      return "This reset link is invalid or has expired.";
    case "rate_limited":
      return "Too many attempts. Try again later.";
    default:
      return "Could not update password. Try again or request a new reset link.";
  }
}

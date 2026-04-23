/**
 * Polaris Track E — admin forgot-password trigger (interactive island).
 *
 * Renders a "Forgot password?" link beneath the admin login form. Clicking
 * the link opens an inline panel with an email input + "Email me a reset
 * link" button. Submits to `/api/admin/forgot-password`.
 *
 * The endpoint is anti-enumeration: it always returns 200 regardless of
 * whether the email is a registered admin. So the success screen is
 * uniform ("Check your email") and the only error surfaced is a network
 * / 5xx failure.
 *
 * Uses the same visual language as `LoginForm.tsx` (the existing admin
 * login form) so the panel docks seamlessly underneath.
 */

import { useSignal } from "@preact/signals";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { CheckCircle2, Loader2, Mail } from "lucide-preact";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ForgotPasswordFormProps {
  defaultEmail?: string;
}

export default function ForgotPasswordForm(
  { defaultEmail = "" }: ForgotPasswordFormProps,
) {
  const open = useSignal(false);
  const email = useSignal(defaultEmail);
  const loading = useSignal(false);
  const error = useSignal("");
  const sent = useSignal(false);

  const submit = async (ev: Event) => {
    ev.preventDefault();
    if (loading.value) return;
    error.value = "";
    const value = email.value.trim();
    if (!EMAIL_RX.test(value)) {
      error.value = "Enter a valid email address.";
      return;
    }
    loading.value = true;
    try {
      const res = await fetch("/api/admin/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      if (!res.ok) {
        error.value = res.status === 429
          ? "Too many requests. Wait a minute and try again."
          : "Couldn't send the link right now. Try again in a moment.";
        loading.value = false;
        return;
      }
      sent.value = true;
    } catch (_err) {
      error.value = "Network error — check your connection and try again.";
    } finally {
      loading.value = false;
    }
  };

  if (!open.value) {
    return (
      <div class="text-center pt-1">
        <button
          type="button"
          class="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
          onClick={() => {
            open.value = true;
          }}
        >
          Forgot your password?
        </button>
      </div>
    );
  }

  if (sent.value) {
    return (
      <div
        class="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-center space-y-1.5 mt-3"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2
          class="size-6 mx-auto text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        <h3 class="text-sm font-semibold text-foreground">Check your email</h3>
        <p class="text-xs text-muted-foreground">
          If an admin account exists for{" "}
          <span class="font-medium text-foreground">{email.value}</span>, a
          reset link is on its way.
        </p>
        <button
          type="button"
          class="text-xs font-medium text-primary underline-offset-4 hover:underline"
          onClick={() => {
            sent.value = false;
            open.value = false;
            error.value = "";
          }}
        >
          Back to sign-in
        </button>
      </div>
    );
  }

  return (
    <form
      class="rounded-md border border-border bg-muted/30 p-3 space-y-2.5 mt-3"
      onSubmit={submit}
      noValidate
    >
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-sm font-semibold text-foreground">
          Reset admin password
        </h3>
        <button
          type="button"
          class="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            open.value = false;
            error.value = "";
          }}
        >
          Cancel
        </button>
      </div>
      <div class="space-y-1.5">
        <Label htmlFor="forgot-email">Admin email address</Label>
        <Input
          id="forgot-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="admin@example.com"
          required
          disabled={loading.value}
          value={email.value}
          aria-invalid={error.value ? "true" : "false"}
          onInput={(e) => email.value = (e.target as HTMLInputElement).value}
        />
      </div>
      {error.value
        ? (
          <p class="text-xs text-destructive" role="alert">
            {error.value}
          </p>
        )
        : null}
      <Button
        type="submit"
        variant="outline"
        size="sm"
        class="w-full"
        disabled={loading.value}
      >
        {loading.value
          ? (
            <>
              <Loader2 class="mr-2 size-4 animate-spin" />
              Sending…
            </>
          )
          : (
            <>
              <Mail class="mr-2 size-4" />
              Email me a reset link
            </>
          )}
      </Button>
    </form>
  );
}

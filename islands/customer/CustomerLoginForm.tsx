/**
 * Polaris Track E — customer magic-link request form (interactive island).
 *
 * Lives inside `routes/login.tsx`. Renders the email field, the "Email me
 * a sign-in link" outline button, and the success/error chrome.
 *
 * The submit POSTs `/api/auth/magic-link/preflight`. The preflight is
 * anti-enumeration: it ALWAYS responds 200 regardless of whether the
 * email is registered. So the only error state we surface is a network /
 * 5xx failure (the user retried and the request itself didn't reach the
 * server). Anything else flips to the "Check your email" success card.
 *
 * Local validation is intentionally light — a basic `@` shape check so
 * the user gets immediate feedback on obvious typos. The server still
 * does the strict validation; we're just saving a roundtrip.
 */

import { useSignal } from "@preact/signals";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { CheckCircle2, Loader2, Mail } from "lucide-preact";

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CustomerLoginFormProps {
  /**
   * Optional default value for the email field — useful when the page
   * was reached via a deep link that included `?email=...`. Defaults to
   * empty string.
   */
  defaultEmail?: string;
}

export default function CustomerLoginForm(
  { defaultEmail = "" }: CustomerLoginFormProps,
) {
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
      const res = await fetch("/api/auth/magic-link/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      if (!res.ok) {
        // Anti-enumeration design: preflight always returns 200 unless
        // there's a transport/server failure. Surface a generic message
        // and let the user retry.
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

  if (sent.value) {
    return (
      <div
        class="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-center space-y-2"
        role="status"
        aria-live="polite"
      >
        <CheckCircle2
          class="size-8 mx-auto text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        <h3 class="text-sm font-semibold text-foreground">Check your email</h3>
        <p class="text-xs text-muted-foreground">
          If an account exists for{" "}
          <span class="font-medium text-foreground">{email.value}</span>, a
          sign-in link is on its way. The link expires in 15 minutes.
        </p>
        <button
          type="button"
          class="text-xs font-medium text-primary underline-offset-4 hover:underline"
          onClick={() => {
            sent.value = false;
            error.value = "";
          }}
        >
          Try a different email
        </button>
      </div>
    );
  }

  return (
    <form class="space-y-3" onSubmit={submit} noValidate>
      <div class="space-y-1.5">
        <Label htmlFor="login-email">Email address</Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          required
          disabled={loading.value}
          class="h-11 text-base"
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
        size="lg"
        class="w-full h-11"
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
              Email me a sign-in link
            </>
          )}
      </Button>
    </form>
  );
}

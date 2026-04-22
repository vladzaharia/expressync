/**
 * Polaris Track C — admin password reset form (interactive island).
 *
 * Submits `{ token, newPassword }` to `/api/admin/reset-password` and
 * follows the server's `redirectTo` on success. Validates locally that
 * the two password fields match and meet the 12-char minimum before
 * sending — saves a roundtrip on the obvious mistakes.
 *
 * The token is passed in via props (read on the server from `?token=X`).
 */

import { useSignal } from "@preact/signals";

interface ResetPasswordFormProps {
  token: string;
}

const MIN_PASSWORD_LENGTH = 12;

function humanize(code: string): string {
  switch (code) {
    case "invalid_token":
      return "This reset link is invalid or has expired.";
    case "password_must_be_12_to_256_chars":
      return "Password must be at least 12 characters.";
    case "rate_limited":
      return "Too many attempts. Try again later.";
    default:
      return "Could not update password. Try again or request a new reset link.";
  }
}

export default function ResetPasswordForm(props: ResetPasswordFormProps) {
  const newPassword = useSignal("");
  const confirmPassword = useSignal("");
  const error = useSignal("");
  const loading = useSignal(false);

  const submit = async (ev: Event) => {
    ev.preventDefault();
    error.value = "";
    if (newPassword.value !== confirmPassword.value) {
      error.value = "Passwords do not match.";
      return;
    }
    if (newPassword.value.length < MIN_PASSWORD_LENGTH) {
      error.value =
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
      return;
    }
    loading.value = true;
    try {
      const res = await fetch("/api/admin/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: props.token,
          newPassword: newPassword.value,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        error.value = humanize(
          typeof body?.error === "string" ? body.error : "",
        );
        loading.value = false;
        return;
      }
      const to = typeof body?.redirectTo === "string"
        ? body.redirectTo
        : "/login";
      globalThis.location.href = to;
    } catch (_err) {
      error.value = humanize("");
      loading.value = false;
    }
  };

  return (
    <form class="space-y-3" onSubmit={submit} autoComplete="off">
      <div>
        <label for="newPassword" class="block text-sm font-medium mb-1">
          New password (min {MIN_PASSWORD_LENGTH} chars)
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          autoFocus
          value={newPassword.value}
          onInput={(e) =>
            newPassword.value = (e.target as HTMLInputElement).value}
          class="block w-full h-10 px-3 rounded-md border border-input bg-background"
        />
      </div>
      <div>
        <label
          for="confirmPassword"
          class="block text-sm font-medium mb-1"
        >
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          value={confirmPassword.value}
          onInput={(e) =>
            confirmPassword.value = (e.target as HTMLInputElement).value}
          class="block w-full h-10 px-3 rounded-md border border-input bg-background"
        />
      </div>
      {error.value
        ? (
          <div class="text-sm text-destructive" role="alert">
            {error.value}
          </div>
        )
        : null}
      <button
        type="submit"
        disabled={loading.value}
        class="inline-flex items-center justify-center w-full h-11 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 transition disabled:opacity-50"
      >
        {loading.value ? "Updating..." : "Update password"}
      </button>
    </form>
  );
}

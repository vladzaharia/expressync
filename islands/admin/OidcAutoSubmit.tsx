/**
 * Tiny island that kicks off the Pocket ID OIDC sign-in flow.
 *
 * BetterAuth's `/api/auth/sign-in/oauth2` endpoint expects a JSON body
 * and responds with `{ url, redirect }` — it does NOT return a 302. So
 * we can't use a plain HTML form post (the browser would just render
 * the JSON response). Instead we POST JSON via fetch and then assign
 * `window.location.href` to the returned authorize URL.
 *
 * Two modes:
 *   - autoSubmit=true  → kick off the request on mount (mode 2 of the
 *     login page: OIDC-only, no email fallback).
 *   - autoSubmit=false → wait for the user to click the button (mode 3:
 *     OIDC primary, email fallback link below).
 */

import { useEffect, useRef, useState } from "preact/hooks";

interface Props {
  /** Visible button label. */
  label: string;
  /**
   * Path to return the user to after BetterAuth completes the OIDC
   * round-trip. Defaults to "/". Caller must pre-sanitise; we forward
   * verbatim into BetterAuth's `callbackURL`.
   */
  callbackURL?: string;
  /** Auto-submit on mount (mode 2). */
  autoSubmit?: boolean;
}

export default function OidcAutoSubmit(
  { label, callbackURL = "/", autoSubmit = false }: Props,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  async function start() {
    if (startedRef.current) return;
    startedRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/sign-in/oauth2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ providerId: "pocket-id", callbackURL }),
      });
      if (!res.ok) {
        startedRef.current = false;
        setBusy(false);
        setError(`Sign-in failed (${res.status}). Try again.`);
        return;
      }
      const data = await res.json() as { url?: string; redirect?: boolean };
      if (data?.url) {
        globalThis.location.href = data.url;
        return;
      }
      startedRef.current = false;
      setBusy(false);
      setError("Sign-in failed: no redirect URL returned.");
    } catch (e) {
      startedRef.current = false;
      setBusy(false);
      setError(
        `Sign-in failed: ${e instanceof Error ? e.message : "network error"}`,
      );
    }
  }

  useEffect(() => {
    if (autoSubmit) {
      const timer = setTimeout(() => {
        void start();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <div class="space-y-3">
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy}
        class="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {busy ? "Redirecting…" : label}
      </button>
      {error && (
        <p class="text-center text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

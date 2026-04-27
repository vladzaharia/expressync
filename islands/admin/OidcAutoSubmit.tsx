/**
 * Tiny island that auto-submits the Pocket ID OIDC sign-in form on
 * mount. Used by `routes/admin/login.tsx` in mode 2 (OIDC-only) so the
 * BetterAuth start endpoint receives a POST and writes its state cookie
 * before bouncing to the IdP.
 *
 * For no-JS clients, the parent page's <button> remains the visible
 * fallback — clicking it submits the same form by hand.
 */

import { useEffect, useRef } from "preact/hooks";
import type { JSX } from "preact";

interface Props {
  /** Children rendered inside the form (the button). */
  children: JSX.Element | JSX.Element[];
  /**
   * Path to return the user to after BetterAuth completes the OIDC
   * round-trip. Defaults to "/". Caller must pre-sanitise; we forward
   * verbatim into BetterAuth's `callbackURL`.
   */
  callbackURL?: string;
}

export default function OidcAutoSubmit({ children, callbackURL = "/" }: Props) {
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    // Defer one tick so the DOM is fully attached before the synchronous
    // submit triggers a navigation. Some browsers ignore an immediate
    // submit-on-mount when an island still has pending hydration.
    const timer = setTimeout(() => {
      try {
        formRef.current?.submit();
      } catch {
        // Best-effort: a popup blocker / extension might cancel the
        // submit. The visible button remains as a fallback.
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <form
      ref={formRef}
      method="POST"
      action="/api/auth/sign-in/oauth2"
      class="space-y-3"
    >
      <input type="hidden" name="providerId" value="pocket-id" />
      <input type="hidden" name="callbackURL" value={callbackURL} />
      {children}
    </form>
  );
}

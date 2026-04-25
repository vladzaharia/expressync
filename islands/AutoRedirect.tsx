/**
 * Polaris Track C — small island that redirects to a target URL after a
 * delay. Used by the `/auth/scan` deep-link landing so QR scanners that
 * land on the page bounce to the proper login screen.
 *
 * Lives in `islands/` because Fresh requires hydrated DOM access for
 * `globalThis.location.href`.
 */

import { useEffect } from "preact/hooks";
import { clientNavigate } from "@/src/lib/nav.ts";

interface AutoRedirectProps {
  href: string;
  /** Delay before redirect in milliseconds. Default 800ms. */
  delayMs?: number;
}

export default function AutoRedirect(
  { href, delayMs = 800 }: AutoRedirectProps,
) {
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        clientNavigate(href);
      } catch {
        // Some test runners / sandbox envs don't allow location writes;
        // clientNavigate's own try/catch falls back to location.assign,
        // so this outer catch only fires for truly hostile environments.
      }
    }, delayMs);
    return () => clearTimeout(t);
  }, [href, delayMs]);
  return null;
}

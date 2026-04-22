/**
 * Polaris Track C — small island that redirects to a target URL after a
 * delay. Used by the `/auth/scan` deep-link landing so QR scanners that
 * land on the page bounce to the proper login screen.
 *
 * Lives in `islands/` because Fresh requires hydrated DOM access for
 * `globalThis.location.href`.
 */

import { useEffect } from "preact/hooks";

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
        globalThis.location.href = href;
      } catch {
        // Some test runners / sandbox envs don't allow location writes.
      }
    }, delayMs);
    return () => clearTimeout(t);
  }, [href, delayMs]);
  return null;
}

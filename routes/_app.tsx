// The inline theme bootstrap script uses dangerouslySetInnerHTML intentionally —
// it must execute before hydration to prevent a flash of the wrong theme.
// deno-lint-ignore-file react-no-danger
import { define } from "../utils.ts";
import { Partial } from "fresh/runtime";
import { Toaster } from "sonner";
import CommandPalette from "../islands/CommandPalette.tsx";
import ScanTagPaletteHost from "../islands/ScanTagPaletteHost.tsx";
import SseProvider from "../islands/shared/SseProvider.tsx";

/**
 * Polaris Track A — root document. Hostname-aware: reads
 * `ctx.state.surface` (set by `_middleware.ts` after hostname dispatch) and
 * picks the right manifest, favicon set, theme bootstrap, and theme-color
 * meta. Customer (`polaris.express`) and admin (`manage.polaris.express`)
 * each install as separate PWAs because the manifest URL differs per
 * surface and PWA installability keys off the manifest URL.
 *
 * Defaults to the admin surface when `state.surface` is missing (e.g.
 * during static-asset prefetch or middleware bypass) — matches pre-Polaris
 * behavior so existing tests keep passing.
 */
export default define.page(function App({ Component, state }) {
  const surface = state.surface ?? "admin";
  const isAdmin = surface === "admin";

  const manifestHref = isAdmin ? "/manifest.admin.json" : "/manifest.json";
  const themeColor = isAdmin ? "#0ea5e9" : "#0E7C66";
  const title = isAdmin ? "ExpresSync" : "Polaris Express";
  // Both surfaces default to dark; the bootstrap script reads the
  // per-host localStorage key and overrides if the user picked light.
  const htmlClass = "dark";

  // Favicon set per surface — matches the manifest icon entries so the
  // browser's <link rel=icon> picker finds the right asset before the
  // manifest is fetched.
  const faviconBase = isAdmin ? "favicon" : "polaris-favicon";

  // Per-surface localStorage key + default theme. Kept in sync with
  // `hooks/use-theme.tsx` (storageKey + defaultTheme) and the SSR class
  // above so there's no flash on first paint.
  const themeBootstrap = `
              (function() {
                const isAdmin = location.hostname.startsWith('manage.') || location.hostname === 'localhost';
                const key = isAdmin ? 'ev-billing-theme' : 'polaris-theme';
                const stored = localStorage.getItem(key);
                // Both surfaces default to dark; light is opt-in.
                const theme = stored || 'dark';
                if (theme === 'system') {
                  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                  document.documentElement.classList.remove('light', 'dark');
                  document.documentElement.classList.add(systemTheme);
                } else {
                  document.documentElement.classList.remove('light', 'dark');
                  document.documentElement.classList.add(theme);
                }
              })();
            `;

  return (
    <html lang="en" class={htmlClass}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content={themeColor} />
        <title>{title}</title>
        <link rel="manifest" href={manifestHref} />
        <link
          rel="icon"
          type="image/png"
          sizes="16x16"
          href={`/${faviconBase}-16.png`}
        />
        <link
          rel="icon"
          type="image/png"
          sizes="32x32"
          href={`/${faviconBase}-32.png`}
        />
        <link
          rel="icon"
          type="image/png"
          sizes="48x48"
          href={`/${faviconBase}-48.png`}
        />
        <link
          rel="icon"
          type="image/png"
          sizes="192x192"
          href={`/${faviconBase}-192.png`}
        />
        <link
          rel="icon"
          type="image/png"
          sizes="512x512"
          href={`/${faviconBase}-512.png`}
        />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/apple-touch-icon.png"
        />
        <link rel="stylesheet" href="/assets/styles.css" />
        <script
          dangerouslySetInnerHTML={{
            __html: themeBootstrap,
          }}
        />
      </head>
      <body
        class="min-h-screen bg-background text-foreground antialiased"
        f-client-nav
      >
        {
          /*
          Polaris Track H — Skip-link. Hidden visually until focused, then
          jumps the user past the navigation chrome to the page's main
          content. Pages must tag their `<main>` with `id="main-content"`
          (SidebarLayout / SidebarWrapper handle this for the standard
          shell). Easy a11y win — keyboard users press Tab on page load
          and immediately see the link.
        */
        }
        <a
          href="#main-content"
          class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded"
        >
          Skip to main content
        </a>
        {
          /*
          Fresh 2 client-side navigation requires every route response to
          contain at least one named <Partial>. The runtime fetches the new
          page, looks for `<!--frsh:partial:NAME...-->` markers, and replaces
          the matching Partial in-place. Without this wrapper, partial-nav
          fetches throw "Found no partials in HTML response" — but the URL has
          already been pushed via history.pushState, so users see the URL
          change with no DOM update (the originally reported "broken nav"
          symptom). Keep the global chrome (Toaster, CommandPalette,
          SseProvider) OUTSIDE the partial so they survive route swaps and
          retain their state.
        */
        }
        <Partial name="body">
          <Component />
        </Partial>
        <Toaster richColors position="bottom-right" />
        <CommandPalette surface={surface} />
        {
          /* Admin-only: hidden modal host that the palette's "Scan EV Card"
            action opens. Mounting it once at the root means the action
            works from any page, not only /admin/tags. */
        }
        {isAdmin && <ScanTagPaletteHost />}
        <SseProvider />
      </body>
    </html>
  );
});

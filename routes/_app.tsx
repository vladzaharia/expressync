// The inline theme bootstrap script uses dangerouslySetInnerHTML intentionally —
// it must execute before hydration to prevent a flash of the wrong theme.
// deno-lint-ignore-file react-no-danger
import { define } from "../utils.ts";
import { Toaster } from "sonner";
import CommandPalette from "../islands/CommandPalette.tsx";

export default define.page(function App({ Component }) {
  return (
    <html lang="en" class="dark">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>ExpresSync</title>
        <link rel="stylesheet" href="/assets/styles.css" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const theme = localStorage.getItem('ev-billing-theme') || 'dark';
                if (theme === 'system') {
                  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                  document.documentElement.classList.add(systemTheme);
                } else {
                  document.documentElement.classList.remove('light', 'dark');
                  document.documentElement.classList.add(theme);
                }
              })();
            `,
          }}
        />
      </head>
      <body class="min-h-screen bg-background text-foreground antialiased">
        <Component />
        <Toaster richColors position="bottom-right" />
        <CommandPalette />
      </body>
    </html>
  );
});

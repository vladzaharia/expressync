import { define } from "../utils.ts";

export default define.page(function App({ Component, state, url }) {
  // Don't show navbar on login page - we'll use sidebar layout instead
  const isLoginPage = url.pathname === "/login";

  return (
    <html lang="en" class="dark">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>ExpresSync - OCPP Portal</title>
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
      </body>
    </html>
  );
});

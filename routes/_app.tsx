import { define } from "../utils.ts";
import Navbar from "../components/Navbar.tsx";

export default define.page(function App({ Component, state, url }) {
  // Don't show navbar on login page
  const isLoginPage = url.pathname === "/login";

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>EV Billing Portal</title>
        <link rel="stylesheet" href="/assets/styles.css" />
      </head>
      <body class="bg-gray-100 min-h-screen">
        {!isLoginPage && state.user && <Navbar user={state.user} />}
        <Component />
      </body>
    </html>
  );
});

/**
 * Client-side navigation helper that cooperates with Fresh's `f-client-nav`.
 *
 * Assigning to `location.href` forces a full document reload and bypasses
 * Fresh's partial-nav interceptor, which is why menu items, row clicks, and
 * filter submits used to trigger a full refresh — sometimes appearing to
 * "do nothing" on the first click. Instead, we synthesize a real anchor
 * click so Fresh's interceptor takes over.
 *
 * Prefer a real `<a href>` in markup wherever possible; only reach for this
 * helper when the navigation must follow async work (e.g. after a sign-out
 * fetch) or when the caller is a non-anchor element like a dropdown item.
 */
export function clientNavigate(href: string): void {
  if (typeof document === "undefined") return;
  try {
    const a = document.createElement("a");
    a.href = href;
    // Ensure it's visible to Fresh's delegated click handler on <body>.
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    // Fallback: if something prevents the synthetic click, fall back to a
    // full-page navigation rather than leaving the user stuck.
    globalThis.location.assign(href);
  }
}

/** POSTs to /api/auth/sign-out then navigates via f-client-nav. */
export async function signOutAndRedirect(href = "/login"): Promise<void> {
  try {
    await fetch("/api/auth/sign-out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch {
    // Non-fatal — navigate anyway so the user isn't stuck.
  }
  clientNavigate(href);
}

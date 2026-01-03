/**
 * Sign out the current user
 */
export async function signOut(): Promise<void> {
  await fetch("/api/auth/sign-out", { method: "POST" });
  window.location.href = "/login";
}

/**
 * Get current session (for client-side checks)
 */
export async function getSession() {
  const res = await fetch("/api/auth/session");
  if (res.ok) {
    return res.json();
  }
  return null;
}


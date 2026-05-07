/**
 * `?back=...` query-param sanitiser.
 *
 * The login pages take an optional `back` param so the account picker
 * can drop a return-arrow on the form. Naively rendering whatever the
 * user puts there is an open-redirect bug; sanitise to:
 *   - relative paths starting with `/` (most common — `/switch`), OR
 *   - absolute URLs whose origin matches one of our two surfaces
 *     (CUSTOMER_BASE_URL or ADMIN_BASE_URL).
 *
 * Returns null for anything else, including malformed URLs.
 */
export function sanitiseBackHref(
  raw: string | null | undefined,
  allowedOrigins: string[],
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Relative path — only allow ones that start with a single "/" and
  // not "//", which is a protocol-relative URL.
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const allowed = allowedOrigins.some((o) => {
      try {
        return new URL(o).origin === url.origin;
      } catch {
        return false;
      }
    });
    return allowed ? url.toString() : null;
  } catch {
    return null;
  }
}

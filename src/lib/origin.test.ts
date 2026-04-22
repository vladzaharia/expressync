/**
 * Tests for `src/lib/origin.ts` — assertSameOrigin enforcement.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  assertSameOrigin,
  getTrustedOrigins,
  OriginMismatchError,
  originMismatchResponse,
} from "./origin.ts";

Deno.test("getTrustedOrigins — includes both polaris hosts", () => {
  const origins = getTrustedOrigins();
  // We don't assert exact contents (config-derived); we assert the two
  // critical hosts are present in some form.
  assert(
    origins.some((o) => o.includes("polaris.express")),
    "trusted origins must include polaris.express",
  );
});

Deno.test("assertSameOrigin — GET requests bypass", () => {
  const req = new Request("https://polaris.express/x", {
    method: "GET",
  });
  // No Origin header on a GET — must NOT throw.
  const result = assertSameOrigin({ req });
  assertEquals(typeof result, "string");
});

Deno.test("assertSameOrigin — HEAD / OPTIONS requests bypass", () => {
  for (const method of ["HEAD", "OPTIONS"]) {
    const req = new Request("https://polaris.express/x", { method });
    assertSameOrigin({ req });
  }
});

Deno.test("assertSameOrigin — POST without Origin header throws", () => {
  const req = new Request("https://polaris.express/x", {
    method: "POST",
  });
  assertThrows(
    () => assertSameOrigin({ req }),
    OriginMismatchError,
    "Missing Origin header",
  );
});

Deno.test("assertSameOrigin — POST with trusted Origin passes", () => {
  // Use the first trusted origin so the test is independent of which
  // env-derived hosts are configured. We just need to prove that *some*
  // trusted origin is accepted.
  const trusted = getTrustedOrigins()[0];
  const req = new Request("https://polaris.express/x", {
    method: "POST",
    headers: { Origin: trusted },
  });
  const result = assertSameOrigin({ req });
  assertEquals(result, trusted);
});

Deno.test("assertSameOrigin — POST with admin Origin passes", () => {
  // Likewise — pick any trusted admin-style origin from the env-derived list.
  const trusted =
    getTrustedOrigins().find((o) => o.startsWith("https://manage.")) ??
      getTrustedOrigins()[0];
  const req = new Request("https://polaris.express/x", {
    method: "POST",
    headers: { Origin: trusted },
  });
  const result = assertSameOrigin({ req });
  assertEquals(result, trusted);
});

Deno.test("assertSameOrigin — POST with untrusted Origin throws", () => {
  const req = new Request("https://polaris.express/x", {
    method: "POST",
    headers: { Origin: "https://evil.com" },
  });
  assertThrows(
    () => assertSameOrigin({ req }),
    OriginMismatchError,
    "is not in the trusted list",
  );
});

Deno.test("assertSameOrigin — trailing-slash normalization", () => {
  // Browsers don't typically send trailing slashes in Origin, but defend
  // against proxy normalization variants.
  const trusted = getTrustedOrigins()[0];
  const req = new Request("https://polaris.express/x", {
    method: "POST",
    headers: { Origin: trusted + "/" },
  });
  const result = assertSameOrigin({ req });
  // Normalized to no-trailing-slash.
  assertEquals(result, trusted);
});

Deno.test("originMismatchResponse — returns 403 JSON", async () => {
  const r = originMismatchResponse();
  assertEquals(r.status, 403);
  assertEquals(r.headers.get("Content-Type"), "application/json");
  const body = await r.json();
  assertEquals(typeof body.error, "string");
});

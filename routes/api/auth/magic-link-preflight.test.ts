/**
 * Polaris Track C — magic-link preflight unit tests.
 *
 * Network-free coverage of the email validation + uniform-response
 * contract. Database-backed paths (user lookup, audit insert) are
 * exercised in integration tests; here we lock in the input handling
 * so a regression in the validator can't slip past CI.
 *
 * Resource sanitization is disabled because the handler imports the
 * postgres client which keeps a connection pool alive even when the
 * body validator short-circuits.
 */

import { assertEquals } from "@std/assert";

const ENDPOINT_URL = "https://polaris.express/api/auth/magic-link/preflight";

async function callPreflight(body: unknown): Promise<Response> {
  const { handler } = await import("./magic-link/preflight.ts");
  // deno-lint-ignore no-explicit-any
  const post = (handler as any).POST as (
    ctx: { req: Request },
  ) => Promise<Response>;
  const req = new Request(ENDPOINT_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return await post({ req });
}

Deno.test({
  name: "magic-link preflight — invalid JSON body returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { handler } = await import("./magic-link/preflight.ts");
    // deno-lint-ignore no-explicit-any
    const post = (handler as any).POST as (
      ctx: { req: Request },
    ) => Promise<Response>;
    const req = new Request(ENDPOINT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    const res = await post({ req });
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name: "magic-link preflight — missing email field returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callPreflight({});
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name: "magic-link preflight — non-email string returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callPreflight({ email: "not-an-email" });
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name: "magic-link preflight — empty email string returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callPreflight({ email: "" });
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name:
    "magic-link preflight — well-formed unknown email returns 200 uniform-ok",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    // Without DATABASE_URL the lookup throws and the handler returns
    // uniform-ok — that's the correct behavior (anti-enumeration), and
    // it lets us assert the contract without a live DB.
    const res = await callPreflight({ email: "ghost@example.com" });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ok");
  },
});

Deno.test({
  name: "magic-link preflight — body shape always { status: 'ok' } when 200",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callPreflight({
      email: "another-unknown@example.com",
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    // No additional fields — uniform shape is the security property.
    assertEquals(Object.keys(body).sort(), ["status"]);
    assertEquals(body.status, "ok");
  },
});

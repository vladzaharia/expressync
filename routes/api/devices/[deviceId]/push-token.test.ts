/**
 * PUT /api/devices/{deviceId}/push-token — handler-direct unit tests.
 *
 * Locks in the same auth-gate matrix as the DELETE handler (foreign
 * deviceId rejection is the security-critical branch) plus the
 * push-token / apnsEnvironment body validation.
 */

import { assert, assertEquals } from "@std/assert";

const URL_PUSH_TOKEN_BASE =
  "https://manage.polaris.express/api/devices/11111111-2222-3333-4444-555555555555/push-token";

interface MockState {
  device?: {
    id: string;
    ownerUserId: string;
    capabilities: string[];
    secret: string;
    tokenId: string;
  };
}

const VALID_UUID = "11111111-2222-3333-4444-555555555555";
const OTHER_UUID = "99999999-aaaa-bbbb-cccc-dddddddddddd";

async function callPushToken(
  state: MockState,
  pathDeviceId: string,
  body: unknown,
): Promise<Response> {
  const { handler } = await import("./push-token.ts");
  // deno-lint-ignore no-explicit-any
  const put = (handler as any).PUT as (
    ctx: { req: Request; state: MockState; params: { deviceId: string } },
  ) => Promise<Response>;
  const req = new Request(URL_PUSH_TOKEN_BASE, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body ?? {}),
  });
  return await put({ req, state, params: { deviceId: pathDeviceId } });
}

function deviceState(id: string): MockState {
  return {
    device: {
      id,
      ownerUserId: "admin-1",
      capabilities: ["tap"],
      secret: "deadbeef".repeat(8),
      tokenId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    },
  };
}

const VALID_BODY = {
  pushToken: "abcdef1234567890",
  apnsEnvironment: "sandbox",
};

Deno.test({
  name: "PUT push-token — missing device context returns 401",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callPushToken({}, VALID_UUID, VALID_BODY);
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: "PUT push-token — non-UUID deviceId returns 404",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callPushToken(
      deviceState(VALID_UUID),
      "not-a-uuid",
      VALID_BODY,
    );
    assertEquals(res.status, 404);
  },
});

Deno.test({
  name: "PUT push-token — foreign deviceId returns 403",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callPushToken(
      deviceState(OTHER_UUID),
      VALID_UUID,
      VALID_BODY,
    );
    assertEquals(res.status, 403);
  },
});

Deno.test({
  name: "PUT push-token — invalid JSON returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callPushToken(
      deviceState(VALID_UUID),
      VALID_UUID,
      "{not-json",
    );
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name: "PUT push-token — missing apnsEnvironment returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callPushToken(
      deviceState(VALID_UUID),
      VALID_UUID,
      { pushToken: "tok" },
    );
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name: "PUT push-token — bad apnsEnvironment returns 400",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callPushToken(
      deviceState(VALID_UUID),
      VALID_UUID,
      { pushToken: "tok", apnsEnvironment: "wat" },
    );
    assertEquals(res.status, 400);
  },
});

Deno.test({
  name: "PUT push-token — valid body proceeds past gate (DB-bound)",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const res = await callPushToken(
      deviceState(VALID_UUID),
      VALID_UUID,
      VALID_BODY,
    );
    assert(
      res.status !== 401 && res.status !== 403 && res.status !== 404 &&
        res.status !== 400,
      `unexpected gate-blocking status ${res.status}`,
    );
  },
});

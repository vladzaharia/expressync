import { assertEquals, assertExists } from "@std/assert";
import { destinationOrigin } from "./handoff.ts";

Deno.test("destinationOrigin — admin direction returns admin base URL", () => {
  const url = destinationOrigin(
    "admin",
    "https://example.com",
    "https://manage.example.com",
  );
  assertEquals(url, "https://manage.example.com");
});

Deno.test("destinationOrigin — customer direction returns customer base URL", () => {
  const url = destinationOrigin(
    "customer",
    "https://example.com",
    "https://manage.example.com",
  );
  assertEquals(url, "https://example.com");
});

Deno.test("auth.api exposes the multi-session endpoints after the upgrade", async () => {
  // Lazy import — the auth module loads config at import time which would
  // fail in some CI sub-paths if env isn't set. Importing inside the test
  // body lets the test runner show a clear failure if config is missing,
  // rather than a module-level crash.
  const { auth } = await import("./auth.ts");

  // The plugin contract: these three functions must exist on auth.api
  // for the AccountList island and handoff routes to work.
  assertExists((auth.api as Record<string, unknown>).listDeviceSessions);
  assertExists((auth.api as Record<string, unknown>).setActiveSession);
  assertExists((auth.api as Record<string, unknown>).revokeDeviceSession);
});

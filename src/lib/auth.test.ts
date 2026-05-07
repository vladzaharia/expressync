import { assertExists } from "@std/assert";

Deno.test("auth.api exposes the multi-session endpoints after the upgrade", async () => {
  // Lazy import — the auth module loads config at import time which would
  // fail in some CI sub-paths if env isn't set. Importing inside the test
  // body keeps the failure mode legible if config is missing.
  const { auth } = await import("./auth.ts");

  // Plugin contract: AccountList + the switch page rely on these three
  // endpoints. If a future upgrade drops or renames any of them, this
  // assertion is the canary.
  assertExists((auth.api as Record<string, unknown>).listDeviceSessions);
  assertExists((auth.api as Record<string, unknown>).setActiveSession);
  assertExists((auth.api as Record<string, unknown>).revokeDeviceSession);
});

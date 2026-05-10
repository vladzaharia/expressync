/**
 * QR sign-in — capability-default regression guard.
 *
 * The route is exercised end-to-end by integration tests; here we only need
 * to lock in the rule that customer-flow QR sign-in writes the SHARED
 * `customerCapabilityDefaults()` literal — never something else. This test
 * file is intentionally tiny: it reads the source and asserts the helper
 * is called, so nobody can revert to a hardcoded `["user"]` (or worse,
 * `["scanner", "user"]`) without the suite turning red.
 */

import { assert, assertEquals } from "@std/assert";
import { customerCapabilityDefaults } from "../../../src/lib/auth/customer-capabilities.ts";

Deno.test({
  name: "qr-sign-in — uses customerCapabilityDefaults helper",
  fn: async () => {
    const src = await Deno.readTextFile(
      new URL("./qr-sign-in.ts", import.meta.url),
    );
    assert(
      src.includes("customerCapabilityDefaults()"),
      "qr-sign-in.ts must call customerCapabilityDefaults() — do not hardcode capabilities",
    );
    assert(
      !/capabilities:\s*\[\s*"user"\s*\]/.test(src),
      "qr-sign-in.ts must not contain a literal capabilities: ['user'] — go through the helper",
    );
  },
});

Deno.test({
  name: "customerCapabilityDefaults — returns ['user'] only",
  fn: () => {
    assertEquals([...customerCapabilityDefaults()], ["user"]);
  },
});

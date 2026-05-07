import { assertEquals } from "@std/assert";
import { sanitiseBackHref } from "./back-href.ts";

const ALLOWED = ["https://example.com", "https://manage.example.com"];

Deno.test("sanitiseBackHref — null / empty returns null", () => {
  assertEquals(sanitiseBackHref(null, ALLOWED), null);
  assertEquals(sanitiseBackHref(undefined, ALLOWED), null);
  assertEquals(sanitiseBackHref("", ALLOWED), null);
  assertEquals(sanitiseBackHref("   ", ALLOWED), null);
});

Deno.test("sanitiseBackHref — relative path is allowed", () => {
  assertEquals(sanitiseBackHref("/switch", ALLOWED), "/switch");
  assertEquals(sanitiseBackHref("/foo/bar?x=1", ALLOWED), "/foo/bar?x=1");
});

Deno.test("sanitiseBackHref — protocol-relative URL is rejected", () => {
  assertEquals(sanitiseBackHref("//evil.com/x", ALLOWED), null);
});

Deno.test("sanitiseBackHref — absolute URL on allowed origin is kept", () => {
  assertEquals(
    sanitiseBackHref("https://example.com/switch", ALLOWED),
    "https://example.com/switch",
  );
});

Deno.test("sanitiseBackHref — absolute URL on disallowed origin is rejected", () => {
  assertEquals(sanitiseBackHref("https://evil.example/x", ALLOWED), null);
  // Same suffix, different origin — must not match.
  assertEquals(
    sanitiseBackHref("https://example.com.evil.com/x", ALLOWED),
    null,
  );
});

Deno.test("sanitiseBackHref — malformed URL returns null", () => {
  assertEquals(sanitiseBackHref("not a url", ALLOWED), null);
  assertEquals(sanitiseBackHref("http://", ALLOWED), null);
});

Deno.test("sanitiseBackHref — javascript: URL is rejected", () => {
  // URL parses these; the origin check must reject.
  assertEquals(sanitiseBackHref("javascript:alert(1)", ALLOWED), null);
});

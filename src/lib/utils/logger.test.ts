import { assert, assertEquals } from "@std/assert";
import { logger } from "./logger.ts";

/**
 * Capture every `console.*` write produced by `fn` and return the
 * parsed JSON records. The logger emits one JSON line per call to
 * `console.log/.warn/.error`; this helper restores the originals after
 * every test so we don't pollute other suites.
 */
function captureLogs(fn: () => void): Array<Record<string, unknown>> {
  const captured: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = (msg: unknown) => captured.push(String(msg));
  console.warn = (msg: unknown) => captured.push(String(msg));
  console.error = (msg: unknown) => captured.push(String(msg));
  try {
    fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
  return captured.map((s) => JSON.parse(s));
}

Deno.test("logger emits OTel-shaped JSON with spec-pinned severity numbers", () => {
  const previous = logger.getLevel();
  logger.setLevel("DEBUG");
  try {
    const records = captureLogs(() => {
      logger.debug("Cat", "debug msg");
      logger.info("Cat", "info msg");
      logger.warn("Cat", "warn msg");
      logger.error("Cat", "error msg");
    });
    assertEquals(records.length, 4);

    // Every record carries the OTel-mandated keys.
    for (const r of records) {
      assert(typeof r.timestamp === "string", "timestamp is string-ns");
      assert(
        typeof r.observed_timestamp === "string",
        "observed_timestamp is string-ns",
      );
      assert(typeof r.body === "string");
      assert(typeof r.attributes === "object");
      assert(typeof r.resource === "object");
    }

    // Severity number / text pinned to OTel spec.
    assertEquals(records[0].severity_text, "DEBUG");
    assertEquals(records[0].severity_number, 5);
    assertEquals(records[1].severity_text, "INFO");
    assertEquals(records[1].severity_number, 9);
    assertEquals(records[2].severity_text, "WARN");
    assertEquals(records[2].severity_number, 13);
    assertEquals(records[3].severity_text, "ERROR");
    assertEquals(records[3].severity_number, 17);
  } finally {
    logger.setLevel(previous);
  }
});

Deno.test("logger.child binds category onto attributes.category", () => {
  const previous = logger.getLevel();
  logger.setLevel("DEBUG");
  try {
    const records = captureLogs(() => {
      const log = logger.child("MyRoute");
      log.info("hello", { device_id: "abc-123", count: 5 });
    });
    assertEquals(records.length, 1);
    const attrs = records[0].attributes as Record<string, unknown>;
    assertEquals(attrs.category, "MyRoute");
    assertEquals(attrs.device_id, "abc-123");
    assertEquals(attrs.count, 5);
    assertEquals(records[0].body, "hello");
  } finally {
    logger.setLevel(previous);
  }
});

Deno.test("logger.error flattens Error onto exception.* attributes", () => {
  const previous = logger.getLevel();
  logger.setLevel("DEBUG");
  try {
    const records = captureLogs(() => {
      const err = new Error("boom");
      logger.error("Db", "query failed", err);
    });
    assertEquals(records.length, 1);
    const attrs = records[0].attributes as Record<string, unknown>;
    assertEquals(attrs.category, "Db");
    assertEquals(attrs["exception.type"], "Error");
    assertEquals(attrs["exception.message"], "boom");
    assert(typeof attrs["exception.stacktrace"] === "string");
  } finally {
    logger.setLevel(previous);
  }
});

Deno.test("logger respects level filtering", () => {
  const previous = logger.getLevel();
  logger.setLevel("WARN");
  try {
    const records = captureLogs(() => {
      logger.debug("X", "should not appear");
      logger.info("X", "should not appear either");
      logger.warn("X", "warn appears");
      logger.error("X", "error appears");
    });
    assertEquals(records.length, 2);
    assertEquals(records[0].severity_text, "WARN");
    assertEquals(records[1].severity_text, "ERROR");
  } finally {
    logger.setLevel(previous);
  }
});

import { assertEquals } from "@std/assert";
import { extractRejectedTag } from "@/src/lib/utils/tag-patterns.ts";

// --- Pattern matching ---

Deno.test("extractRejectedTag - matches 'The user with idTag ... is INVALID'", () => {
  const line = "The user with idTag 'ABC123' is INVALID (not present in DB).";
  assertEquals(extractRejectedTag(line), "ABC123");
});

Deno.test("extractRejectedTag - matches 'Authorization rejected for idTag:'", () => {
  const line = "Authorization rejected for idTag: TAG007";
  assertEquals(extractRejectedTag(line), "TAG007");
});

Deno.test("extractRejectedTag - matches 'Unknown idTag:'", () => {
  const line = "Unknown idTag: VISITOR99";
  assertEquals(extractRejectedTag(line), "VISITOR99");
});

Deno.test("extractRejectedTag - matches 'idTag ... not found'", () => {
  const line = "idTag UNKNOWN42 not found in the system";
  assertEquals(extractRejectedTag(line), "UNKNOWN42");
});

Deno.test("extractRejectedTag - matches 'Invalid idTag:'", () => {
  const line = "Invalid idTag: BADTAG";
  assertEquals(extractRejectedTag(line), "BADTAG");
});

Deno.test("extractRejectedTag - matches 'AuthorizationStatus: Invalid ... idTag'", () => {
  const line = "AuthorizationStatus: Invalid for idTag RFID001";
  assertEquals(extractRejectedTag(line), "RFID001");
});

Deno.test("extractRejectedTag - matches 'Authorize.req ... unknown ... tag:'", () => {
  const line = "Authorize.req received for unknown tag: MYSTERY";
  assertEquals(extractRejectedTag(line), "MYSTERY");
});

Deno.test("extractRejectedTag - matches 'idTag=... REJECTED'", () => {
  const line = "idTag=BLOCKED01 status REJECTED";
  assertEquals(extractRejectedTag(line), "BLOCKED01");
});

Deno.test("extractRejectedTag - matches 'REJECTED ... idTag=...'", () => {
  const line = "REJECTED attempt for idTag=DENIED02";
  assertEquals(extractRejectedTag(line), "DENIED02");
});

// --- Non-matching ---

Deno.test("extractRejectedTag - normal log line returns null", () => {
  const line = "INFO: Server started on port 8080";
  assertEquals(extractRejectedTag(line), null);
});

Deno.test("extractRejectedTag - accepted tag line returns null", () => {
  const line = "Authorization accepted for idTag: GOODTAG";
  assertEquals(extractRejectedTag(line), null);
});

// --- Tag ID cleanup ---

Deno.test("extractRejectedTag - trailing punctuation removed from tag ID", () => {
  const line = "The user with idTag 'TAG_DIRTY.' is INVALID";
  assertEquals(extractRejectedTag(line), "TAG_DIRTY");
});

Deno.test("extractRejectedTag - trailing comma removed from tag ID", () => {
  const line = "Unknown idTag: MESSY_TAG,";
  assertEquals(extractRejectedTag(line), "MESSY_TAG");
});

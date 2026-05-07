import { assert, assertEquals, assertMatch } from "@std/assert";
import {
  formatPublicId,
  generatePublicId,
  isValidPublicId,
  PUBLIC_ID_ALPHABET,
  PUBLIC_ID_LENGTH,
  splitPublicId,
} from "./public-id.ts";

Deno.test("generatePublicId — length and alphabet invariants", () => {
  for (let i = 0; i < 200; i++) {
    const id = generatePublicId();
    assertEquals(id.length, PUBLIC_ID_LENGTH);
    assertMatch(id, /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    for (const ch of id) {
      assert(PUBLIC_ID_ALPHABET.includes(ch));
    }
  }
});

Deno.test("generatePublicId — collision-free over a small sample", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 5_000; i++) {
    const id = generatePublicId();
    assert(!seen.has(id), `unexpected collision on ${id}`);
    seen.add(id);
  }
});

Deno.test("isValidPublicId — accepts canonical, rejects everything else", () => {
  assert(isValidPublicId("ABCD2345"));
  assert(!isValidPublicId(""));
  assert(!isValidPublicId("abcd2345")); // lowercase
  assert(!isValidPublicId("0BCD2345")); // contains 0
  assert(!isValidPublicId("OBCD2345")); // contains O
  assert(!isValidPublicId("IBCD2345")); // contains I
  assert(!isValidPublicId("LBCD2345")); // contains L
  assert(!isValidPublicId("UBCD2345")); // contains U
  assert(!isValidPublicId("ABCDEFGHJ")); // too long
  assert(!isValidPublicId("ABCDEFG")); // too short
  assert(!isValidPublicId(12345678 as unknown));
  assert(!isValidPublicId(null as unknown));
});

Deno.test("splitPublicId / formatPublicId", () => {
  assertEquals(splitPublicId("ABCD2345"), ["ABCD", "2345"]);
  assertEquals(formatPublicId("ABCD2345"), "ABCD-2345");
});

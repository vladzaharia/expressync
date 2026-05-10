/**
 * Validates log_scrubber.ts against the shared fixture corpus consumed
 * by both the iOS LogScrubber and this server-side mirror. When you
 * add a new pattern, add a fixture in `docs/logging/scrubber-fixtures.json`
 * and update both implementations in lockstep.
 */

import { assertEquals } from "@std/assert";
import { scrubAttributes, scrubString } from "./log_scrubber.ts";

interface BodyFixture {
  name: string;
  input: string;
  expectedBody: string;
}

interface TypedValue {
  string?: string;
  int?: number;
  double?: number;
  bool?: boolean;
  null?: null;
  array?: TypedValue[];
  object?: Record<string, TypedValue>;
}

interface AttrFixture {
  name: string;
  inputAttributes: Record<string, TypedValue>;
  expectedAttributes: Record<string, TypedValue>;
}

interface FixtureFile {
  bodyFixtures: BodyFixture[];
  attributeFixtures: AttrFixture[];
}

/** Translate the AnyCodableJSON-shaped fixture into a native JS value. */
function decode(v: TypedValue): unknown {
  if (v.string !== undefined) return v.string;
  if (v.int !== undefined) return v.int;
  if (v.double !== undefined) return v.double;
  if (v.bool !== undefined) return v.bool;
  if ("null" in v) return null;
  if (v.array !== undefined) return v.array.map(decode);
  if (v.object !== undefined) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v.object)) out[k] = decode(x);
    return out;
  }
  throw new Error("unknown fixture variant");
}

function decodeAttrs(
  attrs: Record<string, TypedValue>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) out[k] = decode(v);
  return out;
}

const fixturesPath = new URL(
  "../../../docs/logging/scrubber-fixtures.json",
  import.meta.url,
);
const fixtures: FixtureFile = JSON.parse(
  await Deno.readTextFile(fixturesPath),
);

for (const fx of fixtures.bodyFixtures) {
  Deno.test(`log_scrubber body: ${fx.name}`, () => {
    assertEquals(scrubString(fx.input), fx.expectedBody);
  });
}

for (const fx of fixtures.attributeFixtures) {
  Deno.test(`log_scrubber attrs: ${fx.name}`, () => {
    const got = scrubAttributes(decodeAttrs(fx.inputAttributes));
    const want = decodeAttrs(fx.expectedAttributes);
    assertEquals(got, want);
  });
}

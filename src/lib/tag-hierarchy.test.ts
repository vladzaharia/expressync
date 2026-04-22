import { assertEquals } from "@std/assert";
import { getAllChildTags, getAllAncestorTags } from "./tag-hierarchy.ts";
import type { StEvEOcppTag } from "./types/steve.ts";

function makeTag(
  idTag: string,
  parentIdTag: string | null = null,
): StEvEOcppTag {
  return {
    idTag,
    ocppTagPk: Math.floor(Math.random() * 10000),
    note: null,
    parentIdTag,
  };
}

// --- getAllChildTags ---

Deno.test("getAllChildTags - simple parent-child", () => {
  const tags = [
    makeTag("PARENT"),
    makeTag("CHILD", "PARENT"),
  ];

  const children = getAllChildTags("PARENT", tags);

  assertEquals(children.length, 1);
  assertEquals(children[0].idTag, "CHILD");
});

Deno.test("getAllChildTags - multi-level hierarchy", () => {
  const tags = [
    makeTag("ROOT"),
    makeTag("LEVEL1", "ROOT"),
    makeTag("LEVEL2", "LEVEL1"),
    makeTag("LEVEL3", "LEVEL2"),
  ];

  const children = getAllChildTags("ROOT", tags);

  assertEquals(children.length, 3);
  const childIds = children.map((c) => c.idTag);
  assertEquals(childIds.includes("LEVEL1"), true);
  assertEquals(childIds.includes("LEVEL2"), true);
  assertEquals(childIds.includes("LEVEL3"), true);
});

Deno.test("getAllChildTags - cycle does not infinite loop", () => {
  // A -> B -> A (cycle)
  const tags = [
    makeTag("A", "B"),
    makeTag("B", "A"),
  ];

  // Should terminate without hanging
  const childrenOfA = getAllChildTags("A", tags);
  const childrenOfB = getAllChildTags("B", tags);

  // A is a child of B, B is a child of A -- each should find the other
  assertEquals(childrenOfA.length, 1);
  assertEquals(childrenOfA[0].idTag, "B");
  assertEquals(childrenOfB.length, 1);
  assertEquals(childrenOfB[0].idTag, "A");
});

// --- getAllAncestorTags ---

Deno.test("getAllAncestorTags - simple child to parent", () => {
  const parent = makeTag("PARENT");
  const child = makeTag("CHILD", "PARENT");
  const tags = [parent, child];

  const ancestors = getAllAncestorTags(child, tags);

  assertEquals(ancestors.length, 1);
  assertEquals(ancestors[0].idTag, "PARENT");
});

Deno.test("getAllAncestorTags - multi-level ancestry", () => {
  const root = makeTag("ROOT");
  const mid = makeTag("MID", "ROOT");
  const leaf = makeTag("LEAF", "MID");
  const tags = [root, mid, leaf];

  const ancestors = getAllAncestorTags(leaf, tags);

  assertEquals(ancestors.length, 2);
  assertEquals(ancestors[0].idTag, "MID");
  assertEquals(ancestors[1].idTag, "ROOT");
});

Deno.test("getAllAncestorTags - no parent returns empty array", () => {
  const root = makeTag("ROOT");
  const tags = [root];

  const ancestors = getAllAncestorTags(root, tags);

  assertEquals(ancestors.length, 0);
});

Deno.test("getAllAncestorTags - cycle does not infinite loop", () => {
  const tagA = makeTag("A", "B");
  const tagB = makeTag("B", "A");
  const tags = [tagA, tagB];

  const ancestors = getAllAncestorTags(tagA, tags);

  // Should find B as ancestor, then stop because visiting A again would be a cycle
  assertEquals(ancestors.length, 1);
  assertEquals(ancestors[0].idTag, "B");
});

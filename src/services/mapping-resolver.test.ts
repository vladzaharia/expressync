import { assertEquals } from "@std/assert";
import { buildMappingLookupWithInheritance } from "./mapping-resolver.ts";
import type { UserMapping } from "../db/schema.ts";
import type { StEvEOcppTag } from "../lib/types/steve.ts";

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

function makeMapping(
  steveOcppIdTag: string,
  overrides: Partial<UserMapping> = {},
): UserMapping {
  return {
    id: Math.floor(Math.random() * 10000),
    steveOcppTagPk: Math.floor(Math.random() * 10000),
    steveOcppIdTag,
    lagoCustomerExternalId: "cust_001",
    lagoSubscriptionExternalId: "sub_001",
    displayName: null,
    notes: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as UserMapping;
}

Deno.test("buildMappingLookupWithInheritance - direct mapping found", () => {
  const tags = [makeTag("TAG01")];
  const mappings = [makeMapping("TAG01")];

  const lookup = buildMappingLookupWithInheritance(mappings, tags);

  assertEquals(lookup.has("TAG01"), true);
  assertEquals(lookup.get("TAG01")!.steveOcppIdTag, "TAG01");
});

Deno.test("buildMappingLookupWithInheritance - inherited mapping from parent tag", () => {
  const tags = [
    makeTag("PARENT01"),
    makeTag("CHILD01", "PARENT01"),
  ];
  const mappings = [makeMapping("PARENT01")];

  const lookup = buildMappingLookupWithInheritance(mappings, tags);

  assertEquals(lookup.has("CHILD01"), true);
  assertEquals(lookup.get("CHILD01")!.steveOcppIdTag, "PARENT01");
});

Deno.test("buildMappingLookupWithInheritance - no mapping found", () => {
  const tags = [makeTag("TAG01"), makeTag("TAG02")];
  const mappings = [makeMapping("TAG01")];

  const lookup = buildMappingLookupWithInheritance(mappings, tags);

  assertEquals(lookup.has("TAG02"), false);
});

Deno.test("buildMappingLookupWithInheritance - mapping with only customerExternalId is included", () => {
  const tags = [makeTag("TAG01")];
  const mappings = [
    makeMapping("TAG01", {
      lagoSubscriptionExternalId: null,
      lagoCustomerExternalId: "cust_001",
    }),
  ];

  const lookup = buildMappingLookupWithInheritance(mappings, tags);

  assertEquals(lookup.has("TAG01"), true);
  assertEquals(lookup.get("TAG01")!.lagoSubscriptionExternalId, null);
  assertEquals(lookup.get("TAG01")!.lagoCustomerExternalId, "cust_001");
});

Deno.test("buildMappingLookupWithInheritance - cycle protection in tag hierarchy", () => {
  // A -> B -> A (cycle)
  const tags = [
    makeTag("A", "B"),
    makeTag("B", "A"),
  ];
  const mappings: UserMapping[] = [];

  // Should not infinite loop -- just return an empty map
  const lookup = buildMappingLookupWithInheritance(mappings, tags);

  assertEquals(lookup.size, 0);
});

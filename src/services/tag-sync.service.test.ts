/**
 * Tests for `tag-sync.service.ts` — focuses on `syncSingleTagToSteve`, the
 * inline sync helper added in Polaris Track A.
 *
 * The full background sync (`syncTagStatus`) talks to live Lago + StEvE +
 * Postgres; integration tests exercise it. Here we mock `steveClient` and
 * verify only the new helper's contract:
 *
 *   - Happy path → `{ ok: true }`, StEvE called with the right payload
 *   - Failure path → `{ ok: false, error }`, helper does NOT throw
 *   - Inactive mapping → `maxActiveTransactionCount = 0`, deactivation note
 *   - Active mapping → `maxActiveTransactionCount = -1`
 */

import { assertEquals } from "@std/assert";
import { syncSingleTagToSteve } from "./tag-sync.service.ts";
import { steveClient } from "../lib/steve-client.ts";
import type { UserMapping } from "../db/schema.ts";
import type { StEvEOcppTag } from "../lib/types/steve.ts";

function makeMapping(overrides: Partial<UserMapping> = {}): UserMapping {
  return {
    id: 42,
    steveOcppTagPk: 100,
    steveOcppIdTag: "TEST-TAG-001",
    lagoCustomerExternalId: "cust_001",
    lagoSubscriptionExternalId: "sub_001",
    displayName: null,
    notes: null,
    tagType: "ev_card",
    billingTier: "standard",
    cardsIssued: 0,
    isActive: true,
    userId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as UserMapping;
}

interface SteveCall {
  tag: StEvEOcppTag;
}

function mockSteveClient(opts: {
  shouldFail?: boolean;
  failMessage?: string;
}): { calls: SteveCall[]; restore: () => void } {
  const calls: SteveCall[] = [];
  const original = steveClient.updateOcppTag.bind(steveClient);
  type Fn = typeof steveClient.updateOcppTag;
  (steveClient as unknown as { updateOcppTag: Fn }).updateOcppTag = (async (
    tag: StEvEOcppTag,
  ) => {
    calls.push({ tag });
    if (opts.shouldFail) {
      throw new Error(opts.failMessage ?? "StEvE 502 Bad Gateway");
    }
    return await Promise.resolve();
  }) as Fn;
  return {
    calls,
    restore: () => {
      (steveClient as unknown as { updateOcppTag: Fn }).updateOcppTag =
        original;
    },
  };
}

Deno.test("syncSingleTagToSteve — active mapping → unlimited + ok", async () => {
  const mock = mockSteveClient({});
  try {
    const mapping = makeMapping({ isActive: true });
    const result = await syncSingleTagToSteve(mapping);
    assertEquals(result.ok, true);
    assertEquals(result.error, undefined);
    assertEquals(mock.calls.length, 1);
    assertEquals(mock.calls[0].tag.maxActiveTransactionCount, -1);
    assertEquals(mock.calls[0].tag.idTag, "TEST-TAG-001");
    assertEquals(mock.calls[0].tag.ocppTagPk, 100);
    // Note must include "Active mapping" + the mapping id for the active
    // path so an operator opening StEvE can correlate.
    const note = mock.calls[0].tag.note ?? "";
    if (!note.includes("Active mapping 42")) {
      throw new Error(
        `expected note to include 'Active mapping 42', got ${note}`,
      );
    }
  } finally {
    mock.restore();
  }
});

Deno.test(
  "syncSingleTagToSteve — inactive mapping → blocked + dated deactivation note",
  async () => {
    const mock = mockSteveClient({});
    try {
      const mapping = makeMapping({ isActive: false, id: 7 });
      const result = await syncSingleTagToSteve(mapping);
      assertEquals(result.ok, true);
      assertEquals(mock.calls.length, 1);
      assertEquals(mock.calls[0].tag.maxActiveTransactionCount, 0);
      const note = mock.calls[0].tag.note ?? "";
      if (!note.includes("Deactivated by Polaris")) {
        throw new Error(
          `expected note to include 'Deactivated by Polaris', got ${note}`,
        );
      }
      if (!note.includes("(mapping 7)")) {
        throw new Error(`expected note to include '(mapping 7)', got ${note}`);
      }
    } finally {
      mock.restore();
    }
  },
);

Deno.test(
  "syncSingleTagToSteve — failure path → returns ok:false, does not throw",
  async () => {
    const mock = mockSteveClient({
      shouldFail: true,
      failMessage: "StEvE 502 connection refused",
    });
    try {
      const mapping = makeMapping({ isActive: false });
      const result = await syncSingleTagToSteve(mapping);
      // Best-effort: the helper MUST NOT throw, even on failure.
      assertEquals(result.ok, false);
      assertEquals(result.error, "StEvE 502 connection refused");
      assertEquals(mock.calls.length, 1);
      // Notification insertion will fail (no DB in unit tests) — that's
      // exercised in integration tests. The function itself must still
      // return cleanly.
    } finally {
      mock.restore();
    }
  },
);

Deno.test(
  "syncSingleTagToSteve — non-Error throw is normalized to a message",
  async () => {
    const original = steveClient.updateOcppTag.bind(steveClient);
    type Fn = typeof steveClient.updateOcppTag;
    (steveClient as unknown as { updateOcppTag: Fn }).updateOcppTag = (() => {
      // deno-lint-ignore no-throw-literal
      throw "string error";
    }) as Fn;
    try {
      const result = await syncSingleTagToSteve(makeMapping());
      assertEquals(result.ok, false);
      assertEquals(result.error, "string error");
    } finally {
      (steveClient as unknown as { updateOcppTag: Fn }).updateOcppTag =
        original;
    }
  },
);

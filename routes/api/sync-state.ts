import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";

export const handler = define.handlers({
  async GET(_ctx) {
    try {
      const syncState = await db.select().from(schema.transactionSyncState);

      return new Response(JSON.stringify(syncState), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch sync state" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});


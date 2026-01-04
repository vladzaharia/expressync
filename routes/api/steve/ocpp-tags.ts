import { define } from "../../../utils.ts";
import { steveClient } from "../../../src/lib/steve-client.ts";

export const handler = define.handlers({
  async GET(_ctx) {
    try {
      // Use the properly configured StEvE client
      const tags = await steveClient.getOcppTags();

      // Transform to format for the UI, including parent information
      const simplifiedTags = tags.map((tag) => ({
        id: tag.idTag,
        ocppTagPk: tag.ocppTagPk,
        note: tag.note || "",
        parentIdTag: tag.parentIdTag,
      }));

      return new Response(JSON.stringify(simplifiedTags), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Failed to fetch StEvE OCPP tags:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch OCPP tags" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },

  async POST(ctx) {
    try {
      const body = await ctx.req.json();
      const { idTag, note, parentIdTag, maxActiveTransactionCount } = body;

      if (!idTag || typeof idTag !== "string") {
        return new Response(
          JSON.stringify({ error: "idTag is required and must be a string" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      // Validate idTag format (alphanumeric, max 20 chars per OCPP spec)
      if (!/^[a-zA-Z0-9_-]{1,20}$/.test(idTag)) {
        return new Response(
          JSON.stringify({
            error: "idTag must be 1-20 alphanumeric characters (including _ and -)",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const result = await steveClient.createOcppTag(idTag, {
        note,
        parentIdTag,
        maxActiveTransactionCount,
      });

      return new Response(
        JSON.stringify({
          id: idTag,
          ocppTagPk: result.ocppTagPk,
          note: note || "",
          parentIdTag: parentIdTag || null,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    } catch (error) {
      console.error("Failed to create StEvE OCPP tag:", error);
      const message = error instanceof Error ? error.message : "Failed to create OCPP tag";
      return new Response(
        JSON.stringify({ error: message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});

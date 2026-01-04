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
});

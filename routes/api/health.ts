import { define } from "../../utils.ts";

/**
 * Health check endpoint for Docker
 * This endpoint is public (no authentication required)
 */
export const handler = define.handlers({
  GET(_ctx) {
    return new Response(
      JSON.stringify({
        status: "ok",
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  },
});

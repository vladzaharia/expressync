import { define } from "../../../utils.ts";
import { dockerClient } from "../../../src/lib/docker-client.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

/**
 * Regex patterns to detect rejected/failed OCPP tag authentication attempts
 * These patterns match StEvE log entries for unauthorized tags
 */
const TAG_REJECTION_PATTERNS = [
  // Pattern: "Authorization rejected for idTag: ABC123"
  /Authorization rejected for idTag:\s*(\S+)/i,
  // Pattern: "Unknown idTag: ABC123"
  /Unknown idTag:\s*(\S+)/i,
  // Pattern: "idTag ABC123 not found"
  /idTag\s+(\S+)\s+not found/i,
  // Pattern: "Invalid idTag: ABC123"
  /Invalid idTag:\s*(\S+)/i,
  // Pattern: "AuthorizationStatus: Invalid for idTag ABC123"
  /AuthorizationStatus:\s*Invalid.*idTag\s+(\S+)/i,
  // Pattern: "Authorize.req received for unknown tag: ABC123"
  /Authorize\.req.*unknown.*tag:\s*(\S+)/i,
  // Pattern: "REJECTED" with idTag in context
  /idTag[=:\s]+["']?(\S+?)["']?.*(?:REJECTED|INVALID|BLOCKED)/i,
  /(?:REJECTED|INVALID|BLOCKED).*idTag[=:\s]+["']?(\S+?)["']?/i,
];

/**
 * Extract tag ID from a log line if it matches rejection patterns
 */
function extractRejectedTag(logLine: string): string | null {
  for (const pattern of TAG_REJECTION_PATTERNS) {
    const match = logLine.match(pattern);
    if (match && match[1]) {
      // Clean up the tag ID (remove quotes, trailing punctuation)
      return match[1].replace(/['".,;:!?]+$/, "").trim();
    }
  }
  return null;
}

/**
 * GET /api/tag/detect
 *
 * Server-Sent Events endpoint for real-time OCPP tag detection.
 * Streams detected rejected/unknown tags from StEvE Docker logs.
 *
 * Query parameters:
 * - timeout: Maximum duration in seconds (default: 60)
 */
export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const timeout = parseInt(url.searchParams.get("timeout") || "60", 10);

    // Check if Docker is available
    const dockerAvailable = await dockerClient.isAvailable();
    if (!dockerAvailable) {
      return new Response(
        JSON.stringify({
          error: "Docker socket not available",
          message: "Cannot connect to Docker to stream StEvE logs",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    logger.info("TagDetection", "Starting tag detection stream", { timeout });

    // Create SSE stream
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const seenTags = new Set<string>();
        const startTime = Date.now();
        const timeoutMs = timeout * 1000;

        // Send initial connection event
        controller.enqueue(
          encoder.encode(
            `event: connected\ndata: ${JSON.stringify({ timeout })}\n\n`,
          ),
        );

        try {
          // Stream logs from Docker
          const logStream = dockerClient.streamLogs({
            follow: true,
            tail: 0, // Only new logs
            since: Math.floor(Date.now() / 1000), // From now
          });

          for await (const line of logStream) {
            // Check timeout
            if (Date.now() - startTime > timeoutMs) {
              controller.enqueue(
                encoder.encode(
                  `event: timeout\ndata: ${
                    JSON.stringify({ message: "Detection timeout reached" })
                  }\n\n`,
                ),
              );
              break;
            }

            // Try to extract rejected tag
            const tagId = extractRejectedTag(line);
            if (tagId && !seenTags.has(tagId)) {
              seenTags.add(tagId);
              logger.info("TagDetection", "Detected rejected tag", {
                tagId,
                line,
              });

              controller.enqueue(
                encoder.encode(
                  `event: tag-detected\ndata: ${
                    JSON.stringify({
                      tagId,
                      timestamp: new Date().toISOString(),
                      logLine: line.substring(0, 200), // Truncate for safety
                    })
                  }\n\n`,
                ),
              );
            }
          }
        } catch (error) {
          logger.error("TagDetection", "Stream error", error as Error);
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${
                JSON.stringify({ error: (error as Error).message })
              }\n\n`,
            ),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  },
});

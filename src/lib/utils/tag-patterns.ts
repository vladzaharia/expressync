/**
 * OCPP tag rejection pattern matching utilities
 *
 * Extracted from tag/detect route to allow pure-function testing without
 * triggering Docker client imports at module load time.
 */

/**
 * Regex patterns to detect rejected/failed OCPP tag authentication attempts
 * These patterns match StEvE log entries for unauthorized tags
 */
export const TAG_REJECTION_PATTERNS = [
  // Pattern: "The user with idTag 'ABC123' is INVALID (not present in DB)." - StEvE actual format
  /The user with idTag ['"]?([^'"]+)['"]? is INVALID/i,
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
export function extractRejectedTag(logLine: string): string | null {
  for (const pattern of TAG_REJECTION_PATTERNS) {
    const match = logLine.match(pattern);
    if (match && match[1]) {
      // Clean up the tag ID (remove quotes, trailing punctuation)
      return match[1].replace(/['".,;:!?]+$/, "").trim();
    }
  }
  return null;
}

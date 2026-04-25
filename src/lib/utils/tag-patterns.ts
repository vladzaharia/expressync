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
  // Pattern: "idTag=X ... REJECTED/INVALID/BLOCKED"
  // Use [^\s"'] greedy instead of \S+? so we capture the full tag id rather
  // than a single char before the lazy quantifier hands off to .*
  /idTag[=:\s]+["']?([^\s"']+)["']?.*?(?:REJECTED|INVALID|BLOCKED)/i,
  // Pattern: "REJECTED/INVALID/BLOCKED ... idTag=X"
  /(?:REJECTED|INVALID|BLOCKED).*?idTag[=:\s]+["']?([^\s"']+)["']?/i,
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

/**
 * Patterns matching StEvE log lines for successful StartTransaction
 * events. The fallback watchdog uses these to detect transactions that
 * slipped past the pre-authorize hook (e.g. hook timed out, charger had
 * cached authorization). Capture groups: (transactionId, idTag) — order
 * may vary, so the extractor below tries each pattern in turn.
 */
export const START_TRANSACTION_PATTERNS: ReadonlyArray<RegExp> = [
  /StartTransaction\.(?:conf|req)[^\n]*transactionId[=:\s]+(\d+)[^\n]*idTag[=:\s]+["']?([^\s"']+)/i,
  /StartTransaction[^\n]*idTag[=:\s]+["']?([^\s"']+)["']?[^\n]*transactionId[=:\s]+(\d+)/i,
  // Fallback: transactionId only (idTag may not appear in every variant)
  /StartTransaction[^\n]*transactionId[=:\s]+(\d+)/i,
];

export interface StartTransactionExtract {
  transactionId: number;
  idTag: string | null;
}

export function extractStartTransaction(
  logLine: string,
): StartTransactionExtract | null {
  // First pattern: txId-then-idTag
  let m = logLine.match(START_TRANSACTION_PATTERNS[0]);
  if (m) {
    const txId = parseInt(m[1], 10);
    if (Number.isFinite(txId)) {
      return { transactionId: txId, idTag: m[2] ?? null };
    }
  }
  // Second: idTag-then-txId
  m = logLine.match(START_TRANSACTION_PATTERNS[1]);
  if (m) {
    const txId = parseInt(m[2], 10);
    if (Number.isFinite(txId)) {
      return { transactionId: txId, idTag: m[1] ?? null };
    }
  }
  // Third: txId only
  m = logLine.match(START_TRANSACTION_PATTERNS[2]);
  if (m) {
    const txId = parseInt(m[1], 10);
    if (Number.isFinite(txId)) {
      return { transactionId: txId, idTag: null };
    }
  }
  return null;
}

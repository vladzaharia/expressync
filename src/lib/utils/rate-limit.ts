/**
 * Rate limiting utilities
 *
 * Extracted from middleware to allow pure-function testing without
 * triggering framework/database imports at module load time.
 */

// Simple in-memory rate limiter (use Redis in production for multi-instance)
export const rateLimitStore = new Map<
  string,
  { count: number; resetAt: number }
>();

// Rate limiting configuration
export const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

/**
 * Check rate limit for a given key
 */
export function checkRateLimit(key: string, maxRequests: number): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(key);

  // Cleanup expired entries periodically to prevent memory leak
  if (rateLimitStore.size > 10000) {
    for (const [k, v] of rateLimitStore) {
      if (now > v.resetAt) rateLimitStore.delete(k);
    }
  }

  if (!record || now > record.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count++;
  return true;
}

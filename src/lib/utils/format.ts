/**
 * Shared formatting utilities used across the UI.
 */

/**
 * Format a date for display, returning "-" for null/undefined values.
 */
export function formatDate(date: Date | null): string {
  if (!date) return "-";
  return new Date(date).toLocaleString();
}

/**
 * Format the duration between two timestamps into a human-readable string.
 * Returns "Running..." if the end date is null.
 */
export function formatDuration(start: Date, end: Date | null): string {
  if (!end) return "Running...";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

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

/**
 * Format a kW value for display. Preserves one decimal place but trims
 * a trailing `.0` so whole-number ratings read cleanly: 7.68 → "7.7",
 * 11.0 → "11", 11.5 → "11.5". Never rounds to integers — a 7.68 kW
 * charger should not display as "8 kW", since that loses real info
 * users compare against onboard charger specs.
 */
export function formatKw(kw: number): string {
  const rounded = Math.round(kw * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

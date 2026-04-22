/**
 * SSE Metrics (Wave A8)
 *
 * Minimal structured-log metric emitter. Writes a single JSON line to stdout
 * per call so log scrapers (Loki, Datadog, CloudWatch) can aggregate without
 * a dedicated metrics endpoint. Shape is intentionally small and stable:
 *   { "level": "info", "metric": "<name>", "value": <number>,
 *     "tags": {...}, "ts": <ms epoch> }
 */

export function emitMetric(
  name: string,
  value: number,
  tags?: Record<string, string>,
): void {
  const line = {
    level: "info",
    metric: name,
    value,
    tags: tags ?? {},
    ts: Date.now(),
  };
  console.log(JSON.stringify(line));
}

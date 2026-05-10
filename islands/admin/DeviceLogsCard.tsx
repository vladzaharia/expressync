/**
 * DeviceLogsCard — admin-only Phase 3d. Renders the OTel-shaped log
 * stream from `/api/admin/devices/{id}/logs` for a single device with
 * severity / category / time-range filters.
 *
 * Server-side query through our own Fresh handler; renders inside the
 * existing admin chrome. NO iframe to Grafana — the integration
 * principle is "server-side query, our own UI" (see
 * `docs/logging/contract.md` §"Migration path"). When we eventually
 * migrate the read sink to Loki, the Fresh handler swaps from Postgres
 * SELECT to Loki `query_range`; this island stays the same.
 *
 * Live-tail is OFF by default. Polling refresh button is the simple
 * path; SSE live-tail will land in a follow-up slice.
 */

import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import {
  AlertCircle,
  ChevronRight,
  ClipboardCopy,
  Filter,
  Loader2,
  RefreshCcw,
} from "lucide-preact";

interface OTelLogRecord {
  timestamp: string; // nanos as string
  observed_timestamp?: string;
  severity_text: string;
  severity_number: number;
  body: string;
  attributes: Record<string, unknown>;
  resource: Record<string, string>;
  trace_id?: string | null;
  span_id?: string | null;
}

interface FetchResponse {
  logs: OTelLogRecord[];
  nextBeforeSeq: string | null;
  latestSeq: string | null;
}

const SEVERITY_OPTIONS = [
  { value: "DEBUG", label: "Debug" },
  { value: "INFO", label: "Info" },
  { value: "WARN", label: "Warn" },
  { value: "ERROR", label: "Error" },
  { value: "FATAL", label: "Fatal" },
] as const;

const RANGE_OPTIONS = [
  { value: "15m", label: "15 min", ms: 15 * 60_000 },
  { value: "1h", label: "1 hour", ms: 60 * 60_000 },
  { value: "24h", label: "24 hours", ms: 24 * 60 * 60_000 },
  { value: "7d", label: "7 days", ms: 7 * 24 * 60 * 60_000 },
] as const;

interface Props {
  deviceId: string;
  /** Initial server-rendered records to avoid empty-state flash on first paint. */
  initialLogs?: OTelLogRecord[];
}

export default function DeviceLogsCard({ deviceId, initialLogs }: Props) {
  const [records, setRecords] = useState<OTelLogRecord[]>(initialLogs ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSeverities, setSelectedSeverities] = useState<Set<string>>(
    new Set(),
  );
  const [category, setCategory] = useState("");
  const [rangeMs, setRangeMs] = useState<number>(60 * 60_000); // 1h default
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (selectedSeverities.size > 0) {
        params.set("severity", [...selectedSeverities].join(","));
      }
      if (category.trim()) params.set("category", category.trim());
      const since = new Date(Date.now() - rangeMs).toISOString();
      params.set("since", since);
      const url = `/api/admin/devices/${deviceId}/logs?${params}`;
      const res = await fetch(url, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as FetchResponse;
      setRecords(body.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [deviceId, selectedSeverities, category, rangeMs]);

  // Initial fetch (in case the SSR initialLogs is empty/stale).
  useEffect(() => {
    if (!initialLogs || initialLogs.length === 0) {
      fetchLogs();
    }
    // We intentionally only re-fetch on user action below — no auto-refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSeverity = (sev: string) => {
    setSelectedSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(sev)) next.delete(sev);
      else next.add(sev);
      return next;
    });
  };

  const toggleExpanded = (idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const copyAsJsonl = () => {
    const text = records.map((r) => JSON.stringify(r)).join("\n");
    navigator.clipboard?.writeText(text);
  };

  return (
    <div class="flex flex-col gap-4">
      <FilterBar
        severities={selectedSeverities}
        onToggleSeverity={toggleSeverity}
        category={category}
        onCategory={setCategory}
        rangeMs={rangeMs}
        onRangeMs={setRangeMs}
        onRefresh={fetchLogs}
        onCopyAll={copyAsJsonl}
        loading={loading}
        recordCount={records.length}
      />
      {error && (
        <div class="flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          <AlertCircle class="size-4" aria-hidden />
          <span>Failed to load logs: {error}</span>
        </div>
      )}
      <LogList
        records={records}
        expanded={expanded}
        onToggle={toggleExpanded}
        loading={loading}
      />
    </div>
  );
}

function FilterBar(props: {
  severities: Set<string>;
  onToggleSeverity: (sev: string) => void;
  category: string;
  onCategory: (v: string) => void;
  rangeMs: number;
  onRangeMs: (ms: number) => void;
  onRefresh: () => void;
  onCopyAll: () => void;
  loading: boolean;
  recordCount: number;
}) {
  return (
    <div class="flex flex-wrap items-center gap-2">
      <div class="inline-flex items-center gap-1 text-xs text-slate-500">
        <Filter class="size-3.5" aria-hidden />
        Severity:
      </div>
      {SEVERITY_OPTIONS.map((opt) => {
        const active = props.severities.has(opt.value);
        return (
          <button
            type="button"
            key={opt.value}
            onClick={() => props.onToggleSeverity(opt.value)}
            class={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
              active
                ? severityFilterClass(opt.value)
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
      <div class="ml-2 inline-flex items-center gap-1 text-xs text-slate-500">
        Range:
      </div>
      {RANGE_OPTIONS.map((r) => {
        const active = props.rangeMs === r.ms;
        return (
          <button
            type="button"
            key={r.value}
            onClick={() => props.onRangeMs(r.ms)}
            class={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
              active
                ? "bg-teal-600 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {r.label}
          </button>
        );
      })}
      <input
        type="text"
        placeholder="category"
        value={props.category}
        onInput={(e) => props.onCategory((e.target as HTMLInputElement).value)}
        class="ml-2 w-32 rounded-md border border-slate-300 px-2 py-1 text-xs"
      />
      <div class="ml-auto flex items-center gap-2">
        <span class="text-xs text-slate-500">
          {props.loading ? "Loading…" : `${props.recordCount} records`}
        </span>
        <button
          type="button"
          onClick={props.onCopyAll}
          disabled={props.recordCount === 0}
          class="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
          title="Copy as JSONL"
        >
          <ClipboardCopy class="size-3.5" aria-hidden /> Copy
        </button>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.loading}
          class="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40"
        >
          {props.loading
            ? <Loader2 class="size-3.5 animate-spin" aria-hidden />
            : <RefreshCcw class="size-3.5" aria-hidden />}
          Refresh
        </button>
      </div>
    </div>
  );
}

function LogList(props: {
  records: OTelLogRecord[];
  expanded: Set<number>;
  onToggle: (idx: number) => void;
  loading: boolean;
}) {
  if (!props.loading && props.records.length === 0) {
    return (
      <div class="rounded-md border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">
        No log records match the current filters.
      </div>
    );
  }
  return (
    <div class="rounded-md border border-slate-200 bg-slate-50 font-mono text-xs">
      <ol>
        {props.records.map((r, idx) => (
          <LogRow
            key={`${r.timestamp}-${idx}`}
            record={r}
            expanded={props.expanded.has(idx)}
            onToggle={() => props.onToggle(idx)}
          />
        ))}
      </ol>
    </div>
  );
}

function LogRow(props: {
  record: OTelLogRecord;
  expanded: boolean;
  onToggle: () => void;
}) {
  const r = props.record;
  const time = useMemo(() => formatTimestamp(r.timestamp), [r.timestamp]);
  const category = (r.attributes?.["category"] as string | undefined) ?? "";
  return (
    <li class="border-b border-slate-200 last:border-b-0">
      <button
        type="button"
        onClick={props.onToggle}
        class="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-white"
      >
        <ChevronRight
          aria-hidden
          class={`mt-0.5 size-3.5 shrink-0 text-slate-400 transition-transform ${
            props.expanded ? "rotate-90" : ""
          }`}
        />
        <span class="shrink-0 tabular-nums text-slate-500">{time}</span>
        <span
          class={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            severityRowClass(r.severity_text)
          }`}
        >
          {r.severity_text}
        </span>
        {category && <span class="shrink-0 text-slate-500">{category}</span>}
        <span class="grow truncate text-slate-900">{r.body}</span>
      </button>
      {props.expanded && (
        <div class="border-t border-slate-200 bg-white px-3 py-2">
          <pre class="overflow-x-auto whitespace-pre text-[11px] text-slate-700">
            {JSON.stringify(r, null, 2)}
          </pre>
        </div>
      )}
    </li>
  );
}

function formatTimestamp(nanosString: string): string {
  // OTel timestamps are nanoseconds; convert to ms for `Date`.
  try {
    const ms = Number(BigInt(nanosString) / 1_000_000n);
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    const fff = String(d.getMilliseconds()).padStart(3, "0");
    return `${hh}:${mm}:${ss}.${fff}`;
  } catch {
    return "—";
  }
}

function severityFilterClass(sev: string): string {
  switch (sev) {
    case "DEBUG":
      return "bg-slate-500 text-white";
    case "INFO":
      return "bg-sky-600 text-white";
    case "WARN":
      return "bg-amber-500 text-white";
    case "ERROR":
      return "bg-rose-600 text-white";
    case "FATAL":
      return "bg-rose-800 text-white";
    default:
      return "bg-slate-500 text-white";
  }
}

function severityRowClass(sev: string): string {
  switch (sev) {
    case "DEBUG":
      return "bg-slate-200 text-slate-700";
    case "INFO":
      return "bg-sky-100 text-sky-800";
    case "WARN":
      return "bg-amber-100 text-amber-900";
    case "ERROR":
      return "bg-rose-100 text-rose-900";
    case "FATAL":
      return "bg-rose-200 text-rose-950";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

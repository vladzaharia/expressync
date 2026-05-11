# Device-log pipeline — wire format & contract

Single source of truth for the structured-log path that flows from iOS devices
into the expressync server. **The wire format is the load-bearing decision**:
producers and consumers agree on field names and severity numbers, so swapping
the storage sink later (Postgres → Loki, VictoriaLogs, etc.) is a server-side
reimplementation rather than an ecosystem-wide migration.

## Overview

```
iOS app                                          server                          admin web UI
─────────                                        ─────────                       ─────────────
Logger.info("...", metadata: ...)                                                
  → MultiplexLogHandler                                                          
      ├─ OSLogHandler  ──────────────────► Console.app (dev)                     
      └─ RingBufferJSONLogHandler                                                
            ├─ LogScrubber                                                       
            └─ JSONL on disk (5 MB ring)                                         
                  │                                                              
                  ▼ (every sync, 100 records max)                                
            POST /api/devices/me/state/sync                                      
                  │                                                              
                  ▼                                                              
            INSERT INTO device_logs ON CONFLICT (device_id, seq) DO NOTHING      
                  │                                                              
                  ├─► LogBus.publish() ───► SSE /logs-stream ──► EventSource ───► live tail
                  │                                                              
                  └─► GET /api/admin/devices/{id}/logs ──────────────────────────► DeviceLogsCard
```

Server-side log producers (Pino under `src/lib/utils/logger.ts`) emit the same
OTel JSON shape to stdout — captured by `docker logs` and piped through a future
log-shipper if/when we adopt Loki.

## OTelLogRecord JSON shape

```json
{
  "timestamp": 1715000000000000000,
  "observed_timestamp": 1715000000500000000,
  "severity_text": "WARN",
  "severity_number": 13,
  "body": "scan completed",
  "attributes": {
    "expressync.seq": "42",
    "category": "scan",
    "duration_ms": 412,
    "code.function": "submitScan(idTag:pairingCode:)",
    "code.filepath": "ScanCoordinator.swift",
    "code.lineno": 412
  },
  "resource": {
    "service.name": "ExpresScan-iOS",
    "service.version": "1.4.2",
    "device.id": "abc-123-…",
    "os.name": "iOS",
    "os.version": "26.0"
  },
  "trace_id": null,
  "span_id": null
}
```

Field rules:

| Field                | Type                     | Notes                                                                                                                          |
| -------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `timestamp`          | `int64`                  | Nanoseconds since the Unix epoch. Producer-set. Server clamps to `now*1e6 + 5e9` (5 s ceiling) to defeat clock-skew poisoning. |
| `observed_timestamp` | `int64`                  | Nanoseconds. Producer-set on iOS (handler ingest moment); server-set on its own logs.                                          |
| `severity_text`      | `string`                 | One of `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. Note `NOTICE` collapses to `INFO`.                                  |
| `severity_number`    | `int`                    | OTel-spec values: 1 / 5 / 9 / 13 / 17 / 21. Pinned.                                                                            |
| `body`               | `string`                 | Human message. PII-scrubbed by `LogScrubber` before write. Truncated to 4 KiB server-side.                                     |
| `attributes`         | `object`                 | Heterogeneous JSON (`AnyCodableJSON`/`Record<string, unknown>`). Always carries `expressync.seq` and `category`.               |
| `resource`           | `object<string, string>` | Per-process constants (service+device+os). Identical for every record from a given process boot.                               |
| `trace_id`           | `string \| null`         | 32-hex W3C Trace Context. Reserved; not emitted today.                                                                         |
| `span_id`            | `string \| null`         | 16-hex W3C Trace Context. Reserved; not emitted today.                                                                         |

### Why `expressync.seq` is a string

The per-device monotonic idempotency key is `UInt64`, which doesn't fit in a JS
`Number` (53-bit mantissa). Sending it as a string preserves precision across
the JSON boundary. Server stores it as `numeric(20,0)` and uses
`(device_id, seq)` as the `device_logs` PK.

## Severity mapping

| OTel `severity_text` | OTel `severity_number` | swift-log `Logger.Level` | Pino level | Pino numeric |
| -------------------- | ---------------------- | ------------------------ | ---------- | ------------ |
| TRACE                | 1                      | `.trace`                 | `trace`    | 10           |
| DEBUG                | 5                      | `.debug`                 | `debug`    | 20           |
| INFO                 | 9                      | `.info` / `.notice`      | `info`     | 30           |
| WARN                 | 13                     | `.warning`               | `warn`     | 40           |
| ERROR                | 17                     | `.error`                 | `error`    | 50           |
| FATAL                | 21                     | `.critical`              | `fatal`    | 60           |

## PII scrubber

Both sides apply identical regex-driven redaction BEFORE any write to disk or
network. Fixtures are shared at
[`scrubber-fixtures.json`](./scrubber-fixtures.json) — both repos run the same
corpus through their respective scrubbers.

Patterns:

- **Email**: `[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}` → `<email>`
- **JWT**: `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` → `<jwt>`
- **Bearer**: `(?i)bearer\s+[A-Za-z0-9._\-]{8,}` → `Bearer <token>`
- **Phone (E.164)**: `\+\d{7,15}\b` → `<phone>`

Attribute KEYS that wholesale-redact their VALUES:

- `Authorization`, `authorization`, `cookie`, `Cookie`, `set-cookie`,
  `Set-Cookie`, `x-auth-token`, `X-Auth-Token`
- Any key matching `^card_*`

The scrubber recursively walks nested arrays and objects in `attributes`. The
`resource` block is left intact — by construction it carries no PII
(`service.name`, `os.version`, `device.id`).

iOS implementation: `Sources/DeviceLogging/LogScrubber.swift`. Server
implementation: `expressync/src/lib/utils/log_scrubber.ts` (invoked by the Pino
formatter as a final pass).

## Sync envelope additions

`POST /api/devices/me/state/sync` body:

```ts
{
  pendingSettings: PendingSetting[],
  diagnostics: Diagnostics,
  // … existing fields …
  logs?: OTelLogRecord[],          // max 100 records, ~250 KB delta
  logCursor?: string,               // highest seq in this batch (UInt64-as-string)
  location?: LocationSnapshot,      // Phase 2; managed devices only
}
```

Response augmentations (additive — older clients ignore):

```ts
{
  // … existing fields …
  logs?: {
    ackedSeq: string,                 // max accepted seq, UInt64-as-string
    droppedDuplicates: number,        // count of records the server already had
  }
}
```

Server semantics:

- Inserts run inside the existing `withIdempotency` transaction. Retry with the
  same `Idempotency-Key` returns the cached envelope without re-running side
  effects.
- Bulk insert via
  `INSERT … ON CONFLICT (device_id, seq) DO NOTHING
  RETURNING seq`. Cap is 100
  records per request.
- `attributes`/`resource` validated by zod with a 4 KiB-per-record limit.
- A `LogBus.publish()` call after each successful insert pushes the new records
  to in-process SSE subscribers (the admin "Live tail" button consumes this).

## Storage

Postgres `device_logs` table (migration 0053):

```sql
CREATE TABLE device_logs (
  device_id        uuid           NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  seq              numeric(20,0)  NOT NULL,
  timestamp_ns     bigint         NOT NULL,
  observed_ts      timestamptz    NOT NULL DEFAULT now(),
  severity_text    text           NOT NULL,
  severity_number  smallint       NOT NULL,
  body             text           NOT NULL,
  category         text,
  trace_id         text,
  span_id          text,
  attributes       jsonb          NOT NULL DEFAULT '{}'::jsonb,
  resource         jsonb          NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (device_id, seq)
);
```

Indices:

- `(device_id, observed_ts DESC)` — primary admin query.
- `(device_id, severity_number, observed_ts DESC)` — severity filter.
- `(device_id, category, observed_ts DESC)` — category filter.
- `attributes` GIN (`jsonb_path_ops`) — selective attribute search.

Retention: **7 days**, pruned every 6 h by the `device_logs_retention_prune`
cron in `sync-worker.ts`. A daily `device_logs_size_alarm` warns when
`pg_total_relation_size` > 1 GB.

## Read API

`GET /api/admin/devices/{deviceId}/logs?severity=&category=&since=&until=&beforeSeq=&afterSeq=&limit=`

- Admin-cookie auth (the `/api/admin/*` middleware enforces this).
- Keyset pagination on `(observed_ts, seq)`.
- `limit` default 100, max 500.
- Response: `{ logs: OTelLogRecord[], nextBeforeSeq, latestSeq }`.

`GET /api/admin/devices/{deviceId}/logs-stream` — SSE via the existing
`openSseStream` infra (`src/lib/sse.ts`). `MAX_CONNECTIONS=100`. Use
`Last-Event-ID` to resume after a dropped connection. Single-replica fan-out
(the `LogBus` is in-process); multi-replica deployments would need to broker
through Postgres `LISTEN/NOTIFY` or a Redis pubsub.

## Migration path

When the table exceeds 5 GB, full-text search becomes a frequent need, or
trace-correlation across iOS+server is wanted: swap the sink to Grafana Loki
monolithic + Grafana behind Authentik via oauth2-proxy on `logs.example.com` (or
VictoriaLogs as the lighter alternative). The wire format doesn't change.
Concretely:

1. Replace the `INSERT INTO device_logs` in
   `routes/api/devices/me/state/sync.ts` with a Loki HTTP push
   (`/loki/api/v1/push`).
2. Point Pino at the same Loki endpoint via `pino-loki`.
3. Reimplement `routes/api/admin/devices/[id]/logs.ts` against `query_range` —
   keep `DeviceLogsCard.tsx` intact. **Do not iframe Grafana into the
   device-details page**: the integration principle is "server-side query,
   render in our own UI." An "Open in Grafana" deep-link is fine for ad-hoc
   exploration.
4. Drop the Postgres table after one release as fallback.

## Privacy

- Customer-facing disclosure: see the `diagnostic-logs` card in
  `expressync/src/lib/legal/privacy-policy.ts`.
- iOS bundle declaration: `App/Resources/PrivacyInfo.xcprivacy` carries
  `NSPrivacyCollectedDataTypeOtherDiagnosticData` (linked-to-user,
  app-functionality, not used for tracking).

## Pointers

- iOS substrate: `Sources/DeviceLogging/` (in `vladzaharia/ExpresScan`).
- Server logger: `src/lib/utils/logger.ts` (Pino with OTel formatters).
- Migration: `drizzle/0053_device_logs.sql`.
- Scrubber fixtures (shared): `docs/logging/scrubber-fixtures.json`.
- Phased plan: see
  `~/.claude/plans/i-m-having-trouble-loading-sleepy-crescent.md`.

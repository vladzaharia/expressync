# Sync Worker Manual Trigger

This document explains how the manual sync trigger works using PostgreSQL LISTEN/NOTIFY.

## Architecture

The system uses PostgreSQL's built-in LISTEN/NOTIFY feature for inter-process communication between the web app and the sync worker.

```
┌─────────────┐                    ┌──────────────┐                    ┌─────────────┐
│   Web App   │                    │  PostgreSQL  │                    │ Sync Worker │
│             │                    │              │                    │             │
│  /api/sync  │──NOTIFY──────────▶│   Channel:   │──────LISTEN───────▶│  handleSync │
│             │  'sync_trigger'    │ sync_trigger │                    │             │
└─────────────┘                    └──────────────┘                    └─────────────┘
```

## Components

### 1. Sync Notifier Service (`src/services/sync-notifier.service.ts`)

Provides the `triggerSync()` function that sends a NOTIFY command to PostgreSQL:

```typescript
await triggerSync("api"); // Sends notification to sync worker
```

- Creates a dedicated postgres connection for notifications
- Sends JSON payload with source and timestamp
- Handles errors gracefully

### 2. Sync Worker (`sync-worker.ts`)

The sync worker:
- Creates a dedicated LISTEN connection on startup
- Listens to the `sync_trigger` channel
- Calls `handleSync()` when notification received
- Continues to run on cron schedule as before

### 3. API Endpoint (`routes/api/sync.ts`)

The `/api/sync` endpoint:
- Calls `triggerSync("api")` instead of `runSync()` directly
- Returns immediately after sending notification
- Does not wait for sync to complete

## Benefits

1. **Real-time**: Instant notification delivery (no polling)
2. **No new dependencies**: Uses PostgreSQL's built-in feature
3. **Lightweight**: Minimal overhead
4. **Reliable**: PostgreSQL handles message delivery
5. **Simple**: Clean separation of concerns

## Usage

### From UI

Click the "Trigger Sync" button in the dashboard. This calls `POST /api/sync`.

### From API

```bash
curl -X POST http://localhost:8000/api/sync
```

Response:
```json
{
  "success": true,
  "message": "Sync trigger notification sent to worker"
}
```

### From Code

```typescript
import { triggerSync } from "./src/services/sync-notifier.service.ts";

await triggerSync("webhook"); // Custom source identifier
```

## How It Works

1. User clicks "Trigger Sync" button
2. Web app calls `POST /api/sync`
3. API endpoint calls `triggerSync("api")`
4. Notification sent via `NOTIFY sync_trigger '{"source":"api","timestamp":"..."}'`
5. Sync worker receives notification via LISTEN
6. Sync worker calls `handleSync()` asynchronously
7. API returns success immediately (doesn't wait for sync)

## Monitoring

Check sync worker logs to see when notifications are received:

```
[Sync Worker] Received sync trigger notification from api
[Sync Worker] Starting scheduled sync...
```

## Error Handling

- If notification fails to send, API returns 500 error
- If sync worker is not running, notification is lost (no retry)
- If sync is already running, it will be skipped (prevents overlapping)

## Technical Details

- **Channel**: `sync_trigger`
- **Payload**: JSON with `{ source, timestamp }`
- **Connection**: Dedicated postgres connection for LISTEN (separate from Drizzle)
- **Reconnection**: Automatic reconnection handled by postgres.js library


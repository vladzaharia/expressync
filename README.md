# OCPP Billing Sync

A billing synchronization system that bridges StEvE OCPP management system with
Lago billing platform.

## Architecture

This application consists of two services:

1. **Web Application** (`app`) - Fresh framework UI and API
2. **Sync Worker** (`sync-worker`) - Dedicated service for scheduled
   synchronization

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│   Web App       │     │   Sync Worker    │     │  PostgreSQL │
│  (Fresh UI/API) │────▶│   (Croner)       │────▶│  Database   │
└─────────────────┘     └──────────────────┘     └─────────────┘
        │                        │                       ▲
        │                        │                       │
        └────────────────────────┴───────────────────────┘
                    Shared Database Connection
```

### Why Separate Services?

- **Reliability**: Web server restarts don't affect sync schedule
- **Scalability**: Services can be scaled independently
- **Separation of concerns**: UI/API separate from background jobs
- **Better debugging**: Separate logs for each service

## Features

- 🔐 **Secure Authentication** - BetterAuth with email/password
- 📊 **Dashboard** - Real-time stats and sync status
- 🔗 **OCPP Tag Mappings** - Map OCPP tags to Lago customers/subscriptions
- 💳 **Billing Events** - View and filter synced transactions
- ⚡ **Manual Sync** - Trigger synchronization on-demand
- 🐳 **Docker Ready** - Full containerized deployment

## Quick Start

### Prerequisites

- Docker and Docker Compose
- StEvE OCPP Management System API access
- Lago Billing Platform API access

### Setup

1. **Clone and configure**

```bash
git clone <repository-url>
cd ocpp-billing
cp .env.example .env
# Edit .env with your API credentials
```

2. **Start services**

```bash
docker compose up -d
```

3. **Create admin user**

```bash
# Run seed script with environment variables
docker compose exec -e ADMIN_EMAIL=admin@example.com \
  -e ADMIN_PASSWORD=your_secure_password \
  -e ADMIN_NAME="Admin User" \
  app deno run -A scripts/seed-admin.ts
```

4. **Access the application**

- Web Portal: http://localhost:8000
- Login with your admin credentials
- API: http://localhost:8000/api

### Development

Make sure to install Deno:
https://docs.deno.com/runtime/getting_started/installation

Then start the project in development mode:

```bash
deno task dev
```

This will watch the project directory and restart as necessary.

## Services

### Web Application

- **Port**: 8000
- **Framework**: Fresh (Deno)
- **Purpose**: UI and API endpoints

### Sync Worker

- **Scheduler**: Croner (production-ready cron)
- **Schedule**: Every 15 minutes (configurable)
- **Purpose**: Automated billing synchronization
- **Manual Trigger**: PostgreSQL LISTEN/NOTIFY for instant sync triggers

See [docs/SYNC-WORKER.md](docs/SYNC-WORKER.md) and
[docs/SYNC-TRIGGER.md](docs/SYNC-TRIGGER.md) for detailed documentation.

## Configuration

Key environment variables:

```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/database

# StEvE OCPP API
STEVE_API_URL=https://steve.example.com
STEVE_API_KEY=your_api_key

# Lago Billing API
LAGO_API_URL=https://api.getlago.com
LAGO_API_KEY=your_api_key
LAGO_METRIC_CODE=ev_charging_kwh

# Authentication
AUTH_SECRET=your_random_secret_key_min_32_chars
AUTH_URL=http://localhost:8000

# Sync Schedule (Unix cron format)
SYNC_CRON_SCHEDULE=*/15 * * * *
SYNC_ON_STARTUP=false
```

See `.env.example` for all available options.

## Portal Features

### Dashboard

- Total and active mappings count
- Today's and this week's transaction statistics
- Recent sync runs with status

### OCPP Tag Mappings

- Create, edit, and delete mappings
- Map OCPP tags to Lago customers and subscriptions
- Toggle active/inactive status
- Automatic dropdown population from StEvE and Lago APIs

### Billing Events

- View all synced transactions
- Filter by date range
- See kWh consumption and Lago event IDs

### Sync Status

- View sync run history
- Manual sync trigger
- Error tracking and debugging

## Documentation

- [Sync Worker Guide](docs/SYNC-WORKER.md) - Detailed sync worker documentation
- [Fresh Documentation](https://fresh.deno.dev/docs) - Fresh framework docs

## Monitoring

```bash
# View all logs
docker compose logs -f

# View sync worker logs only
docker compose logs -f sync-worker

# Check service status
docker compose ps

# Trigger manual sync
curl -X POST http://localhost:8000/api/sync
```

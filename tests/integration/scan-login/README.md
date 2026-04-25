# scan-login OCPP intercept — integration test harness

End-to-end regression suite for the scan-to-login Pre-Authorize hook
feature shipped across SteVe (`/docker/services/ocpp/`) and ExpresSync
(this repo). Spins up a self-contained docker compose stack (mariadb +
SteVe + postgres + ExpresSync app + migrate), seeds it, then drives a
Go-based OCPP 1.6J chargepoint simulator (`cpsim`) from a Deno test
process to verify the 14 scenarios in `scan_login_test.ts`.

## Prerequisites

- Docker (with `docker compose` v2)
- Go 1.22+ (for building `cpsim`)
- Deno 2.x (matches the rest of the repo)

## Run

From the repo root:

```sh
deno task test:integration:scan-login
```

That invokes `runner.ts`, which:

1. Generates a per-run env file in `mktemp -d` (random secrets, random
   charge-box ids and tags). All credentials are 32-byte random hex.
2. Builds the cpsim Go binary into the temp dir.
3. `docker compose -p scanlogin-<id> up --build --wait` (timeout 900s —
   SteVe runs Maven inside the container on first boot).
4. Discovers the host-mapped ports for `steve:8180` and
   `expressync-app:8000` (compose binds `0:<port>`).
5. Seeds mariadb (ocpp_tag, charge_box rows) and postgres (users,
   user_mappings).
6. Runs `deno test scan_login_test.ts`.
7. Tears down the stack and removes the temp dir, even on failure or
   SIGINT/SIGTERM.

## Orphan cleanup

If a previous run was killed mid-stride, prune leftover containers:

```sh
docker compose ls -a --format '{{.Name}}' \
  | grep '^scanlogin-' \
  | xargs -I{} docker compose -p {} down -v --remove-orphans
```

## Layout

```
scan-login/
├── docker-compose.test.yml   # full stack (mariadb, steve, postgres, app, migrate)
├── cpsim/                    # Go OCPP 1.6J simulator (JSON-RPC over stdio)
│   ├── go.mod
│   └── cmd/cpsim/main.go
├── harness/
│   ├── env.ts                # generates per-run secrets + temp env file
│   ├── compose.ts            # docker compose helpers (up/down/exec/port/logs)
│   ├── db.ts                 # psql + mysql query helpers via `compose exec`
│   ├── seed.ts               # seeds ocpp_tag, charge_box, users, user_mappings
│   ├── cpsim.ts              # TypeScript client for the cpsim binary
│   ├── assert.ts             # assertEventually + HMAC helpers
│   └── sse.ts                # tiny SSE client for /api/auth/scan-detect
├── scan_login_test.ts        # the 14 scenarios
└── runner.ts                 # orchestrator wired up by the deno task
```

## Scenarios

1. Control (no intent armed)
2. Happy-path login
3. Wrong charger
4. Unknown tag during armed window
5. Hook timeout (PREAUTH_TIMEOUT_MS=1)
6. Hook 5xx
7. Hook malformed JSON
8. HMAC mismatch
9. Watchdog race
10. Intent expired
11. Blocked tag
12. Concurrent intents
13. Replay / idempotency
14. Latency: p99 < 50ms over 200 calls

## Notes / gotchas

- The SteVe Dockerfile runs `./mvnw clean package` at container start.
  First build takes 5–10 minutes; subsequent runs reuse the
  Docker layer cache. The compose healthcheck has a 240s `start_period`
  to allow this.
- `host.docker.internal` is used by SteVe (in scenarios 6, 7, 9) to
  reach a Deno-side stub on the host. On Linux Docker this requires
  `--add-host host.docker.internal:host-gateway` — covered by the
  default compose extra_hosts inheritance from the daemon's
  `host-gateway` plumbing on Docker 20.10+.
- Each scenario that bounces SteVe waits up to 180s for it to come back.
  This is necessary because SteVe re-runs its Maven build on recreate;
  if you hit this often, build a multi-stage Dockerfile that bakes the
  .war once.
- For latency scenario (#14), measurement is host-side (Deno → app).
  In-cluster latency (SteVe → app over the docker network) is typically
  lower, so the 50ms ceiling is conservative.

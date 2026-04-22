import "@std/dotenv/load";

// Helper to strip trailing slashes from URLs
const stripTrailingSlash = (url: string) => url.replace(/\/+$/, "");

/**
 * Application configuration loaded from environment variables
 */
const steveBaseUrl = stripTrailingSlash(Deno.env.get("STEVE_BASE_URL") || "");
const lagoApiBaseUrl = stripTrailingSlash(Deno.env.get("LAGO_API_URL") || "");

export const config = {
  // Database
  DATABASE_URL: Deno.env.get("DATABASE_URL")!,

  // StEvE OCPP Management System
  // User provides base URL (e.g., http://localhost:8080/steve)
  // Dashboard URL = base URL, API URL = base URL + /api
  STEVE_BASE_URL: steveBaseUrl,
  STEVE_API_URL: steveBaseUrl ? `${steveBaseUrl}/api` : "",
  // Username for SteVe REST API Basic auth. Matches SteVe's auth.user.
  STEVE_API_USERNAME: Deno.env.get("STEVE_API_USERNAME")!,
  // Password for SteVe REST API Basic auth. Matches SteVe's webapi.value
  // (the value that seeds web_user.api_password on first boot).
  STEVE_API_KEY: Deno.env.get("STEVE_API_KEY")!,

  // Lago Billing Platform
  // API and dashboard have separate base URLs
  // API URL = LAGO_API_URL + /api/v1
  // Dashboard URL is required for generating links in notes and UI
  LAGO_API_URL: lagoApiBaseUrl ? `${lagoApiBaseUrl}/api/v1` : "",
  LAGO_API_KEY: Deno.env.get("LAGO_API_KEY")!,
  LAGO_METRIC_CODE: Deno.env.get("LAGO_METRIC_CODE") || "ev_charging_kwh",
  LAGO_DASHBOARD_URL: stripTrailingSlash(
    Deno.env.get("LAGO_DASHBOARD_URL") || "",
  ),

  // Sync Configuration
  // SYNC_CRON_SCHEDULE: escape-hatch override. When set to a non-empty string,
  // the adaptive SyncScheduler will use this pattern for ALL tiers, effectively
  // disabling the adaptive logic. Leave unset (or empty) to let the scheduler
  // choose 15m/1h/1w based on Active/Idle/Dormant tier rules (Phase C).
  SYNC_CRON_SCHEDULE: Deno.env.get("SYNC_CRON_SCHEDULE") || "",
  SYNC_ON_STARTUP: Deno.env.get("SYNC_ON_STARTUP") || "false",
  SYNC_LOOKBACK_MINUTES: (() => {
    const val = parseInt(Deno.env.get("SYNC_LOOKBACK_MINUTES") || "1440");
    return isNaN(val) ? 1440 : val;
  })(),
  // Phase C: adaptive cadence tunables
  // Days of no tag changes + no transactions required before the scheduler
  // demotes from Idle to Dormant.
  SYNC_DORMANT_THRESHOLD_DAYS: (() => {
    const val = parseInt(Deno.env.get("SYNC_DORMANT_THRESHOLD_DAYS") || "30");
    return isNaN(val) || val <= 0 ? 30 : val;
  })(),
  // Number of consecutive idle evaluations required to demote tier
  // (avoids thrashing between Active <-> Idle and Idle <-> Dormant).
  SYNC_IDLE_HYSTERESIS_TICKS: (() => {
    const val = parseInt(Deno.env.get("SYNC_IDLE_HYSTERESIS_TICKS") || "2");
    return isNaN(val) || val < 1 ? 2 : val;
  })(),

  // Application
  PORT: (() => {
    const val = parseInt(Deno.env.get("PORT") || "8000");
    return isNaN(val) ? 8000 : val;
  })(),
  DENO_ENV: Deno.env.get("DENO_ENV") || "development",

  // Debug/Logging
  DEBUG_LEVEL: Deno.env.get("DEBUG_LEVEL") || "INFO",

  // Docker (for log streaming)
  DOCKER_SOCKET_PATH: Deno.env.get("DOCKER_SOCKET_PATH") ||
    "/var/run/docker.sock",
  STEVE_CONTAINER_NAME: Deno.env.get("STEVE_CONTAINER_NAME") || "steve",

  // BetterAuth
  AUTH_SECRET: Deno.env.get("AUTH_SECRET")!,
  AUTH_URL: Deno.env.get("AUTH_URL") || "http://localhost:8000",

  // Cloudflare Email Worker (Track D — Polaris Express customer portal).
  // Leave CF_EMAIL_WORKER_URL unset in dev to fall back to console-logging
  // rendered emails instead of POSTing them.
  CF_EMAIL_WORKER_URL: stripTrailingSlash(
    Deno.env.get("CF_EMAIL_WORKER_URL") || "",
  ),
  CF_EMAIL_WORKER_SECRET: Deno.env.get("CF_EMAIL_WORKER_SECRET") || "",

  // Phase P7: SSE backbone. Defaults to enabled; set to "false" to force all
  // SSE endpoints to return 503 so client islands fall back to polling. Useful
  // behind proxies or on constrained networks where long-lived connections
  // aren't viable.
  ENABLE_SSE: Deno.env.get("ENABLE_SSE") !== "false",

  // Wave A8: pluggable SSE transport. "memory" keeps the default in-process
  // fan-out (single worker); "postgres" activates LISTEN/NOTIFY on the
  // `sse_events` channel so multiple worker processes can cooperate.
  SSE_TRANSPORT: (() => {
    const raw = (Deno.env.get("SSE_TRANSPORT") || "memory").toLowerCase();
    return raw === "postgres" ? "postgres" : "memory";
  })() as "memory" | "postgres",

  // Wave A8: maximum queued SSE frames per client before we start dropping.
  // Slow clients are recovered via Last-Event-ID replay on reconnect.
  SSE_MAX_PENDING_PER_CLIENT: (() => {
    const val = parseInt(Deno.env.get("SSE_MAX_PENDING_PER_CLIENT") || "100");
    return isNaN(val) || val <= 0 ? 100 : val;
  })(),
} as const;

/**
 * Validate that all required environment variables are set for the web app
 */
export function validateConfig() {
  const required = [
    "DATABASE_URL",
    "STEVE_BASE_URL",
    "STEVE_API_USERNAME",
    "STEVE_API_KEY",
    "LAGO_API_URL",
    "LAGO_API_KEY",
    "LAGO_DASHBOARD_URL",
    "AUTH_SECRET",
  ];

  const missing = required.filter((key) => !Deno.env.get(key));

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }
}

/**
 * Validate required environment variables for the sync worker
 * (doesn't need AUTH_SECRET since it doesn't handle authentication)
 */
export function validateSyncWorkerConfig() {
  const required = [
    "DATABASE_URL",
    "STEVE_BASE_URL",
    "STEVE_API_USERNAME",
    "STEVE_API_KEY",
    "LAGO_API_URL",
    "LAGO_API_KEY",
    "LAGO_DASHBOARD_URL",
  ];

  const missing = required.filter((key) => !Deno.env.get(key));

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }
}

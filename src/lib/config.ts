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
  SYNC_CRON_SCHEDULE: Deno.env.get("SYNC_CRON_SCHEDULE") || "*/15 * * * *",
  SYNC_ON_STARTUP: Deno.env.get("SYNC_ON_STARTUP") || "false",

  // Application
  PORT: parseInt(Deno.env.get("PORT") || "8000"),
  DENO_ENV: Deno.env.get("DENO_ENV") || "development",

  // Debug/Logging
  DEBUG_LEVEL: Deno.env.get("DEBUG_LEVEL") || "ERROR",

  // Docker (for log streaming)
  DOCKER_SOCKET_PATH: Deno.env.get("DOCKER_SOCKET_PATH") ||
    "/var/run/docker.sock",
  STEVE_CONTAINER_NAME: Deno.env.get("STEVE_CONTAINER_NAME") || "steve",

  // BetterAuth
  AUTH_SECRET: Deno.env.get("AUTH_SECRET")!,
  AUTH_URL: Deno.env.get("AUTH_URL") || "http://localhost:8000",
} as const;

/**
 * Validate that all required environment variables are set for the web app
 */
export function validateConfig() {
  const required = [
    "DATABASE_URL",
    "STEVE_BASE_URL",
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

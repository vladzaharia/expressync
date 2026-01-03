import "@std/dotenv/load";

/**
 * Application configuration loaded from environment variables
 */
export const config = {
  // Database
  DATABASE_URL: Deno.env.get("DATABASE_URL")!,

  // StEvE OCPP Management System
  STEVE_API_URL: Deno.env.get("STEVE_API_URL")!,
  STEVE_API_KEY: Deno.env.get("STEVE_API_KEY")!,

  // Lago Billing Platform
  LAGO_API_URL: Deno.env.get("LAGO_API_URL")!,
  LAGO_API_KEY: Deno.env.get("LAGO_API_KEY")!,
  LAGO_METRIC_CODE: Deno.env.get("LAGO_METRIC_CODE") || "ev_charging_kwh",

  // Sync Configuration
  SYNC_CRON_SCHEDULE: Deno.env.get("SYNC_CRON_SCHEDULE") || "*/15 * * * *",
  SYNC_ON_STARTUP: Deno.env.get("SYNC_ON_STARTUP") || "false",

  // Application
  PORT: parseInt(Deno.env.get("PORT") || "8000"),
  DENO_ENV: Deno.env.get("DENO_ENV") || "development",

  // Debug/Logging
  DEBUG_LEVEL: Deno.env.get("DEBUG_LEVEL") || "ERROR",

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
    "STEVE_API_URL",
    "STEVE_API_KEY",
    "LAGO_API_URL",
    "LAGO_API_KEY",
    "AUTH_SECRET",
  ];

  const missing = required.filter((key) => !Deno.env.get(key));

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
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
    "STEVE_API_URL",
    "STEVE_API_KEY",
    "LAGO_API_URL",
    "LAGO_API_KEY",
  ];

  const missing = required.filter((key) => !Deno.env.get(key));

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}


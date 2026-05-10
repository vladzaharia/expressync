/**
 * Structured logger emitting **OpenTelemetry Logs Data Model** JSON to
 * stdout (one record per line). Identical wire shape to the iOS
 * device-log pipeline (`Sources/DeviceLogging/OTelLogRecord.swift` in
 * the ExpresScan repo) so the eventual `device_logs` table in Postgres
 * (migration 0053) and any future log aggregator (Loki, VictoriaLogs)
 * can union both producers with no field translation. See
 * `docs/logging/contract.md` for the canonical wire-format spec.
 *
 * The public API is preserved EXACTLY from the prior shape:
 *   logger.{debug,info,warn,error}(category, message, context?)
 *   logger.child(category)  → same four methods bound to category
 *   logger.setLevel(level), logger.getLevel()
 * No handlers in the codebase need to change. The change is internal:
 * what previously emitted `{timestamp, level, category, message, ...}`
 * now emits `{timestamp, observed_timestamp, severity_text,
 * severity_number, body, attributes, resource}`.
 *
 * Why not adopt `npm:pino@9` directly? Pino's value-add is its
 * transports, prettifier, and worker-thread sink — none of which we
 * use at our scale (stdout → docker logs is the entire pipeline). The
 * integration cost (Deno's `npm:` specifier semantics around Pino's
 * transport workers) outweighs the benefit until we adopt a real log
 * aggregator. When we do, swap this file's internals to a Pino root
 * with the same `formatters` mapping; the public API contract holds.
 *
 * Log levels (DEBUG_LEVEL env var, default INFO):
 *   ERROR / WARN / INFO / DEBUG
 *
 * Usage:
 *   import { logger } from "./utils/logger.ts";
 *   logger.debug("API", "Request details", { url, method });
 *   const log = logger.child("DeviceMeStateSync");
 *   log.info("synced", { device_id, count: 10 });
 */

export type LogLevel = "ERROR" | "WARN" | "INFO" | "DEBUG";

export interface LogContext {
  [key: string]: unknown;
}

/**
 * OTel severity_number values (spec-pinned). Keep this in lockstep with
 * the iOS `OTelSeverity.number(for:)` map and `docs/logging/contract.md`.
 */
const SEVERITY_NUMBER: Record<LogLevel, number> = {
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
};

/**
 * OTel severity_text values. Always uppercase. The local LogLevel
 * already matches except for Pino-style `WARN` vs. `WARNING`.
 */
const SEVERITY_TEXT: Record<LogLevel, string> = {
  DEBUG: "DEBUG",
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
};

/**
 * Static `resource` block — identical for every record from a given
 * process boot. Mirrors the iOS-side resource block (service+version+
 * device+os) but for the server.
 */
const RESOURCE: Record<string, string> = {
  "service.name": "expressync-server",
  "service.version": Deno.env.get("APP_VERSION") ?? "dev",
  "deployment.environment": Deno.env.get("DEPLOY_ENV") ?? "production",
};

class Logger {
  private level: LogLevel;
  private readonly levels: Record<LogLevel, number> = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3,
  };

  constructor(level: LogLevel = "INFO") {
    this.level = level;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] <= this.levels[this.level];
  }

  /**
   * Build an OTel-shaped log record and serialise it as a single JSON
   * line. The `category` parameter lands in `attributes.category` (the
   * iOS handler does the same — see `RingBufferJSONLogHandler.log`).
   * `Error` instances are flattened into `attributes."exception.*"`
   * per OTel semantic conventions.
   */
  private formatMessage(
    level: LogLevel,
    category: string,
    message: string,
    context?: LogContext | Error,
  ): string {
    const nowNs = BigInt(Date.now()) * 1_000_000n;

    const attributes: Record<string, unknown> = { category };

    if (context instanceof Error) {
      attributes["exception.type"] = context.name;
      attributes["exception.message"] = context.message;
      if (context.stack) {
        attributes["exception.stacktrace"] = context.stack;
      }
    } else if (context) {
      // Lift caller-provided context fields directly into attributes.
      // Special-case `error`/`stack` keys so old call sites that pass
      // `{ error: e.message, stack: e.stack }` still produce
      // OTel-shaped exception attributes.
      for (const [k, v] of Object.entries(context)) {
        if (k === "error" && typeof v === "string") {
          attributes["exception.message"] = v;
        } else if (k === "stack" && typeof v === "string") {
          attributes["exception.stacktrace"] = v;
        } else {
          attributes[k] = v;
        }
      }
    }

    const record = {
      timestamp: nowNs.toString(),
      observed_timestamp: nowNs.toString(),
      severity_text: SEVERITY_TEXT[level],
      severity_number: SEVERITY_NUMBER[level],
      body: message,
      attributes,
      resource: RESOURCE,
    };

    return JSON.stringify(record);
  }

  debug(category: string, message: string, context?: LogContext): void {
    if (this.shouldLog("DEBUG")) {
      console.log(this.formatMessage("DEBUG", category, message, context));
    }
  }

  info(category: string, message: string, context?: LogContext): void {
    if (this.shouldLog("INFO")) {
      console.log(this.formatMessage("INFO", category, message, context));
    }
  }

  warn(category: string, message: string, context?: LogContext | Error): void {
    if (this.shouldLog("WARN")) {
      console.warn(this.formatMessage("WARN", category, message, context));
    }
  }

  error(category: string, message: string, error?: Error | LogContext): void {
    if (this.shouldLog("ERROR")) {
      console.error(this.formatMessage("ERROR", category, message, error));
    }
  }

  /**
   * Child logger bound to a fixed `category`. Returned object has the
   * exact same four methods so `const log = logger.child("Foo");
   * log.info("msg", {ctx})` keeps working at every existing call site.
   */
  child(category: string) {
    return {
      debug: (message: string, context?: LogContext) =>
        this.debug(category, message, context),
      info: (message: string, context?: LogContext) =>
        this.info(category, message, context),
      warn: (message: string, context?: LogContext | Error) =>
        this.warn(category, message, context),
      error: (message: string, error?: Error | LogContext) =>
        this.error(category, message, error),
    };
  }
}

// Get log level from environment variable
const DEBUG_LEVEL = (Deno.env.get("DEBUG_LEVEL") || "INFO") as LogLevel;

// Export singleton logger instance
export const logger = new Logger(DEBUG_LEVEL);

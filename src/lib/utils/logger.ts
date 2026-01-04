/**
 * Debug Logger Utility
 *
 * Provides structured logging with different log levels for debugging production issues.
 * Controlled via DEBUG_LEVEL environment variable.
 *
 * Log Levels:
 * - ERROR: Only errors (default)
 * - WARN: Warnings and errors
 * - INFO: Info, warnings, and errors
 * - DEBUG: All logs including detailed debug information
 *
 * Usage:
 *   import { logger } from "./utils/logger.ts";
 *   logger.debug("API", "Request details", { url, method, body });
 *   logger.info("Sync", "Processing transactions", { count: 10 });
 *   logger.warn("Validation", "Missing mapping", { ocppTag });
 *   logger.error("Database", "Query failed", error);
 */

export type LogLevel = "ERROR" | "WARN" | "INFO" | "DEBUG";

export interface LogContext {
  [key: string]: unknown;
}

/**
 * Logger class with level-based filtering
 */
class Logger {
  private level: LogLevel;
  private readonly levels: Record<LogLevel, number> = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3,
  };

  constructor(level: LogLevel = "ERROR") {
    this.level = level;
  }

  /**
   * Set the log level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Get the current log level
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Check if a log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] <= this.levels[this.level];
  }

  /**
   * Format a log message with timestamp and context
   */
  private formatMessage(
    level: LogLevel,
    category: string,
    message: string,
    context?: LogContext | Error,
  ): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level}] [${category}]`;

    if (!context) {
      return `${prefix} ${message}`;
    }

    if (context instanceof Error) {
      return `${prefix} ${message}\n  Error: ${context.message}\n  Stack: ${context.stack}`;
    }

    // Format context object
    const contextStr = Object.keys(context).length > 0
      ? `\n  ${JSON.stringify(context, null, 2).split("\n").join("\n  ")}`
      : "";

    return `${prefix} ${message}${contextStr}`;
  }

  /**
   * Log a debug message (most verbose)
   */
  debug(category: string, message: string, context?: LogContext): void {
    if (this.shouldLog("DEBUG")) {
      console.log(this.formatMessage("DEBUG", category, message, context));
    }
  }

  /**
   * Log an info message
   */
  info(category: string, message: string, context?: LogContext): void {
    if (this.shouldLog("INFO")) {
      console.log(this.formatMessage("INFO", category, message, context));
    }
  }

  /**
   * Log a warning message
   */
  warn(category: string, message: string, context?: LogContext | Error): void {
    if (this.shouldLog("WARN")) {
      console.warn(this.formatMessage("WARN", category, message, context));
    }
  }

  /**
   * Log an error message
   */
  error(category: string, message: string, error?: Error | LogContext): void {
    if (this.shouldLog("ERROR")) {
      console.error(this.formatMessage("ERROR", category, message, error));
    }
  }

  /**
   * Create a child logger with a fixed category
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
const DEBUG_LEVEL = (Deno.env.get("DEBUG_LEVEL") || "ERROR") as LogLevel;

// Export singleton logger instance
export const logger = new Logger(DEBUG_LEVEL);

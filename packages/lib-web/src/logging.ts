// Structured logging utilities for Runt runtime agents
//
// This module provides a clean logging interface that leverages OpenTelemetry
// for structured, observable logging. It automatically detects the available
// OpenTelemetry API through LiveStore's dependency chain.

import {
  context,
  SpanKind,
  SpanStatusCode,
  trace,
} from "npm:@opentelemetry/api";

/**
 * Log levels in order of severity
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * Configuration for the logger
 */
export interface LoggerConfig {
  /** Minimum log level to output */
  level: LogLevel;
  /** Whether to also output to console */
  console: boolean;
  /** Service name for structured logs */
  service: string;
  /** Additional context to include in all logs */
  context?: Record<string, unknown>;
}

/**
 * Default logger configuration
 */
const DEFAULT_CONFIG: LoggerConfig = {
  level: LogLevel.ERROR,
  console: true,
  service: "runt-agent",
};

/**
 * Structured logger that uses OpenTelemetry for observability
 */
export class Logger {
  private config: LoggerConfig;
  private tracer = trace.getTracer("@runt/lib");

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create a child logger with additional context
   */
  child(context: Record<string, unknown>): Logger {
    return new Logger({
      ...this.config,
      context: { ...this.config.context, ...context },
    });
  }

  /**
   * Log a debug message
   */
  debug(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * Log an info message
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * Log a warning message
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * Log an error message
   */
  error(
    message: string,
    error?: Error | unknown,
    data?: Record<string, unknown>,
  ): void {
    const errorData = error instanceof Error
      ? {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        ...data,
      }
      : { error: String(error), ...data };

    this.log(LogLevel.ERROR, message, errorData);
  }

  /**
   * Create a traced operation with automatic logging
   */
  trace<T>(
    name: string,
    operation: () => Promise<T>,
    attributes?: Record<string, unknown>,
  ): Promise<T> {
    const span = this.tracer.startSpan(name, {
      kind: SpanKind.INTERNAL,
      attributes: {
        service: this.config.service,
        ...this.config.context,
        ...attributes,
      },
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        this.debug(`Starting ${name}`, attributes);
        const result = await operation();
        span.setStatus({ code: SpanStatusCode.OK });
        this.debug(`Completed ${name}`, attributes);
        return result;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        span.recordException(
          error instanceof Error ? error : new Error(String(error)),
        );
        this.error(`Failed ${name}`, error, attributes);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Time an operation and log the duration
   */
  async time<T>(
    name: string,
    operation: () => Promise<T>,
    data?: Record<string, unknown>,
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await operation();
      const duration = performance.now() - start;
      this.info(`${name} completed`, {
        ...data,
        duration_ms: Math.round(duration),
      });
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.error(`${name} failed`, error, {
        ...data,
        duration_ms: Math.round(duration),
      });
      throw error;
    }
  }

  /**
   * Internal logging method
   */
  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (level < this.config.level) {
      return;
    }

    const logData = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      service: this.config.service,
      message,
      ...this.config.context,
      ...data,
    };

    // Add to OpenTelemetry span if available
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.addEvent(message, {
        level: LogLevel[level],
        ...data,
      });
    }

    // Console output if enabled
    if (this.config.console) {
      this.consoleLog(level, message, logData);
    }
  }

  /**
   * Console logging with appropriate formatting
   */
  private consoleLog(
    level: LogLevel,
    message: string,
    data: Record<string, unknown>,
  ): void {
    const timestamp = new Date().toISOString().substring(11, 19); // HH:mm:ss
    const levelStr = LogLevel[level].padEnd(5);
    const prefix = `${timestamp} ${levelStr} [${this.config.service}]`;

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(`${prefix} ${message}`, data);
        break;
      case LogLevel.INFO:
        console.info(
          `${prefix} ${message}`,
          Object.keys(data).length > 3 ? data : "",
        );
        break;
      case LogLevel.WARN:
        console.warn(`${prefix} ${message}`, data);
        break;
      case LogLevel.ERROR:
        console.error(`${prefix} ${message}`, data);
        break;
    }
  }
}

/**
 * Default logger instance
 */
export const logger = new Logger();

/**
 * Create a logger with environment-based configuration
 */
export function createLogger(
  service: string,
  options: Partial<LoggerConfig> = {},
): Logger {
  const level = getLogLevelFromEnv();
  const console = !Deno.env.get("RUNT_DISABLE_CONSOLE_LOGS");

  return new Logger({
    service,
    level,
    console,
    ...options,
  });
}

/**
 * Get log level from environment variables
 */
function getLogLevelFromEnv(): LogLevel {
  const envLevel = Deno.env.get("RUNT_LOG_LEVEL")?.toUpperCase();
  switch (envLevel) {
    case "DEBUG":
      return LogLevel.DEBUG;
    case "INFO":
      return LogLevel.INFO;
    case "WARN":
    case "WARNING":
      return LogLevel.WARN;
    case "ERROR":
      return LogLevel.ERROR;
    default:
      return LogLevel.ERROR;
  }
}

/**
 * Utility to suppress console output for libraries that should be quiet
 */
export function withQuietLogging<T>(operation: () => T): T {
  const originalConsole = {
    log: console.log,
    info: console.info,
    debug: console.debug,
  };

  // Temporarily suppress noisy console methods
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};

  try {
    return operation();
  } finally {
    // Restore console methods
    Object.assign(console, originalConsole);
  }
}

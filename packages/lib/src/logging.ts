// Structured logging utilities for Runt runtime agents
//
// This module provides a clean logging interface that leverages OpenTelemetry
// for structured, observable logging. Configure once at startup, use everywhere.

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
}

/**
 * Structured logger that uses OpenTelemetry for observability
 */
class Logger {
  private config: LoggerConfig = {
    level: LogLevel.INFO,
    console: true,
    service: "runt-agent",
  };

  private tracer = trace.getTracer("@runt/lib");

  /**
   * Configure the logger (call once at startup)
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the current configuration
   */
  getConfig(): LoggerConfig {
    return { ...this.config };
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Log an info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Log an error message
   */
  error(
    message: string,
    error?: Error | unknown,
    context?: Record<string, unknown>,
  ): void {
    const errorData = error instanceof Error
      ? {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
        ...context,
      }
      : { error: String(error), ...context };

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
    context?: Record<string, unknown>,
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await operation();
      const duration = performance.now() - start;
      this.info(`${name} completed`, {
        ...context,
        duration_ms: Math.round(duration),
      });
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.error(`${name} failed`, error, {
        ...context,
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
    context?: Record<string, unknown>,
  ): void {
    if (level < this.config.level) {
      return;
    }

    const logData = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      service: this.config.service,
      message,
      ...context,
    };

    // Add to OpenTelemetry span if available
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.addEvent(message, {
        level: LogLevel[level],
        ...context,
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
 * Global logger instance - configure once, use everywhere
 */
export const logger = new Logger();

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

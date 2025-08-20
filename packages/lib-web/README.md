# @runt/lib-web

Web-compatible logging library for Runt applications.

This package provides a lightweight, web-compatible version of the Runt logging system, containing only the essential logging functionality without the full runtime agent capabilities.

## Features

- Structured logging with OpenTelemetry support
- Configurable log levels (DEBUG, INFO, WARN, ERROR)
- Child loggers with additional context
- Operation tracing and timing utilities
- Environment-based configuration
- Console output suppression utilities

## Usage

### Basic Usage

```typescript
import { logger, createLogger } from "@runt/lib-web";

// Use the default logger
logger.info("Application started");

// Create a custom logger
const appLogger = createLogger("my-app");
appLogger.debug("Debug message");
appLogger.warn("Warning message");
appLogger.error("Error occurred", new Error("Something went wrong"));
```

### Configuration

```typescript
import { Logger, LogLevel } from "@runt/lib-web";

const logger = new Logger({
  level: LogLevel.DEBUG,
  service: "my-service",
  console: true,
  context: { version: "1.0.0" }
});
```

### Child Loggers

```typescript
const parentLogger = createLogger("parent");
const childLogger = parentLogger.child({ 
  userId: "123", 
  sessionId: "abc" 
});

childLogger.info("User action performed"); // Includes parent and child context
```

### Operation Tracing

```typescript
const result = await logger.trace("database-query", async () => {
  // Your async operation here
  return await database.query("SELECT * FROM users");
});
```

### Operation Timing

```typescript
const result = await logger.time("api-call", async () => {
  // Your async operation here
  return await fetch("/api/data");
});
```

### Environment Configuration

Set environment variables to configure logging:

- `RUNT_LOG_LEVEL`: Set log level (DEBUG, INFO, WARN, ERROR)
- `RUNT_DISABLE_CONSOLE_LOGS`: Disable console output

## API Reference

### Classes

#### Logger

The main logging class.

**Constructor:**
```typescript
new Logger(config?: Partial<LoggerConfig>)
```

**Methods:**
- `debug(message: string, data?: Record<string, unknown>): void`
- `info(message: string, data?: Record<string, unknown>): void`
- `warn(message: string, data?: Record<string, unknown>): void`
- `error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void`
- `child(context: Record<string, unknown>): Logger`
- `trace<T>(name: string, operation: () => Promise<T>, attributes?: Record<string, unknown>): Promise<T>`
- `time<T>(name: string, operation: () => Promise<T>, data?: Record<string, unknown>): Promise<T>`

### Functions

- `createLogger(service: string, options?: Partial<LoggerConfig>): Logger`
- `withQuietLogging<T>(operation: () => T): T`

### Types

- `LogLevel`: Enum with DEBUG, INFO, WARN, ERROR
- `LoggerConfig`: Interface for logger configuration

### Constants

- `logger`: Default logger instance

## Development

```bash
# Run tests
deno task test

# Run tests in watch mode
deno task test:watch

# Check types
deno task check

# Format code
deno task fmt

# Lint code
deno task lint
```

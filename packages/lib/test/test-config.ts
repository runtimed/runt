// Test configuration for suppressing verbose logging
//
// This module provides utilities to configure logging and environment
// settings specifically for test environments to reduce noise and
// focus on relevant test output.

// LogLevel type is available but not used in this file

/**
 * Configure environment for quiet test execution
 */
export function configureTestEnvironment(): void {
  // Set log level to ERROR to suppress most logging
  Deno.env.set("RUNT_LOG_LEVEL", "ERROR");

  // Disable console logs for tests
  Deno.env.set("RUNT_DISABLE_CONSOLE_LOGS", "true");

  // Suppress LiveStore debug output
  Deno.env.set("LIVESTORE_LOG_LEVEL", "ERROR");

  // Suppress OpenTelemetry debug output
  Deno.env.set("OTEL_LOG_LEVEL", "ERROR");
}

/**
 * Suppress console output for noisy operations during tests
 */
export function withQuietConsole<T>(
  operation: () => T | Promise<T>,
): T | Promise<T> {
  const originalConsole = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
  };

  // Temporarily suppress console methods
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
  console.warn = () => {};

  try {
    const result = operation();

    // Handle both sync and async operations
    if (result instanceof Promise) {
      return result.finally(() => {
        // Restore console methods
        Object.assign(console, originalConsole);
      });
    } else {
      // Restore console methods for sync operations
      Object.assign(console, originalConsole);
      return result;
    }
  } catch (error) {
    // Always restore console methods on error
    Object.assign(console, originalConsole);
    throw error;
  }
}

/**
 * Create a minimal test logger that only shows errors
 */
export function createTestLogger(service: string) {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message: string, error?: unknown) => {
      // Only show errors in tests
      if (error) {
        console.error(`[${service}] ${message}:`, error);
      } else {
        console.error(`[${service}] ${message}`);
      }
    },
  };
}

/**
 * Check if we're running in a test environment
 */
export function isTestEnvironment(): boolean {
  return Deno.env.get("DENO_TESTING") === "true" ||
    Deno.args.some((arg) => arg.includes("test"));
}

/**
 * Initialize test environment configuration
 * Call this at the beginning of test files that need quiet logging
 */
export function initTestEnvironment(): void {
  if (isTestEnvironment()) {
    configureTestEnvironment();
  }
}

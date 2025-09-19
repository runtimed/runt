// Test utilities for pyodide runtime agent tests

/**
 * Suppresses console output during test execution
 * Handles both synchronous and asynchronous functions
 */
export function withQuietConsole<T>(fn: () => T | Promise<T>): T | Promise<T> {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const originalDebug = console.debug;

  // Replace with no-op functions
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  console.info = () => {};
  console.debug = () => {};

  const restore = () => {
    // Restore original console methods
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    console.info = originalInfo;
    console.debug = originalDebug;
  };

  try {
    const result = fn();

    // Handle async case
    if (result instanceof Promise) {
      return result.finally(restore);
    }

    // Handle sync case
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

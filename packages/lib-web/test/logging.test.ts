/// <reference lib="deno.ns" />
import { assertEquals, assertExists } from "jsr:@std/assert@^1.0.0";
import {
  createLogger,
  Logger,
  logger,
  LogLevel,
  withQuietLogging,
} from "../src/logging.ts";

Deno.test("Logger - should create default logger", () => {
  const testLogger = new Logger();
  assertExists(testLogger);
  assertEquals(testLogger instanceof Logger, true);
});

Deno.test("Logger - should create logger with custom config", () => {
  const testLogger = new Logger({
    level: LogLevel.DEBUG,
    service: "test-service",
    console: false,
  });

  assertExists(testLogger);
});

Deno.test("Logger - should create child logger with additional context", () => {
  const parentLogger = new Logger({
    service: "parent",
    context: { parentKey: "parentValue" },
  });

  const childLogger = parentLogger.child({ childKey: "childValue" });

  assertExists(childLogger);
  assertEquals(childLogger instanceof Logger, true);
});

Deno.test("Logger - should handle different log levels", () => {
  const testLogger = new Logger({
    level: LogLevel.DEBUG,
    console: false,
  });

  // These should not throw
  testLogger.debug("Debug message");
  testLogger.info("Info message");
  testLogger.warn("Warning message");
  testLogger.error("Error message");
});

Deno.test("Logger - should handle error logging with Error object", () => {
  const testLogger = new Logger({
    level: LogLevel.ERROR,
    console: false,
  });

  const testError = new Error("Test error message");
  testLogger.error("Error occurred", testError);
});

Deno.test("Logger - should handle error logging with unknown error", () => {
  const testLogger = new Logger({
    level: LogLevel.ERROR,
    console: false,
  });

  testLogger.error("Error occurred", "String error");
});

Deno.test("Logger - should handle error logging without error object", () => {
  const testLogger = new Logger({
    level: LogLevel.ERROR,
    console: false,
  });

  testLogger.error("Error occurred");
});

Deno.test("Logger - should time operations", async () => {
  const testLogger = new Logger({
    level: LogLevel.INFO,
    console: false,
  });

  const result = await testLogger.time("test operation", async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return "success";
  });

  assertEquals(result, "success");
});

Deno.test("Logger - should trace operations", async () => {
  const testLogger = new Logger({
    level: LogLevel.DEBUG,
    console: false,
  });

  const result = await testLogger.trace("test trace", async () => {
    return "traced result";
  });

  assertEquals(result, "traced result");
});

Deno.test("Logger - should handle traced operation errors", async () => {
  const testLogger = new Logger({
    level: LogLevel.ERROR,
    console: false,
  });

  try {
    await testLogger.trace("failing operation", async () => {
      throw new Error("Test error");
    });
    throw new Error("Should have thrown");
  } catch (error) {
    assertEquals(error instanceof Error, true);
    assertEquals((error as Error).message, "Test error");
  }
});

Deno.test("Logger - should handle timed operation errors", async () => {
  const testLogger = new Logger({
    level: LogLevel.ERROR,
    console: false,
  });

  try {
    await testLogger.time("failing operation", async () => {
      throw new Error("Test error");
    });
    throw new Error("Should have thrown");
  } catch (error) {
    assertEquals(error instanceof Error, true);
    assertEquals((error as Error).message, "Test error");
  }
});

Deno.test("createLogger - should create logger with service name", () => {
  const testLogger = createLogger("test-service");
  assertExists(testLogger);
  assertEquals(testLogger instanceof Logger, true);
});

Deno.test("createLogger - should create logger with options", () => {
  const testLogger = createLogger("test-service", {
    level: LogLevel.DEBUG,
    console: false,
  });

  assertExists(testLogger);
});

Deno.test("default logger - should exist and be usable", () => {
  assertExists(logger);
  assertEquals(logger instanceof Logger, true);

  // Should not throw
  logger.info("Test message");
});

Deno.test("withQuietLogging - should suppress console output", () => {
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalDebug = console.debug;

  let logCalled = false;
  let infoCalled = false;
  let debugCalled = false;

  console.log = () => {
    logCalled = true;
  };
  console.info = () => {
    infoCalled = true;
  };
  console.debug = () => {
    debugCalled = true;
  };

  const result = withQuietLogging(() => {
    console.log("test");
    console.info("test");
    console.debug("test");
    return "success";
  });

  assertEquals(result, "success");
  assertEquals(logCalled, false);
  assertEquals(infoCalled, false);
  assertEquals(debugCalled, false);

  // Restore original console methods
  console.log = originalLog;
  console.info = originalInfo;
  console.debug = originalDebug;
});

Deno.test("LogLevel enum - should have correct values", () => {
  assertEquals(LogLevel.DEBUG, 0);
  assertEquals(LogLevel.INFO, 1);
  assertEquals(LogLevel.WARN, 2);
  assertEquals(LogLevel.ERROR, 3);
});

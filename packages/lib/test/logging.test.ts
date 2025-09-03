/// <reference lib="deno.ns" />

// Tests for logging configuration from environment variables

import { assertEquals, assertExists } from "@std/assert";
import { logger, LogLevel } from "../src/logging.ts";

Deno.test("logger configuration", async (t) => {
  await t.step("should allow manual logger configuration", () => {
    const originalConfig = logger.getConfig();

    try {
      logger.configure({
        level: LogLevel.DEBUG,
        console: false,
        service: "test-service",
      });

      assertEquals(logger.getLevel(), LogLevel.DEBUG);
      assertEquals(logger.getConfig().console, false);
      assertEquals(logger.getConfig().service, "test-service");
    } finally {
      logger.configure(originalConfig);
    }
  });
});

Deno.test("logger instance", async (t) => {
  await t.step("should be a singleton", () => {
    assertExists(logger);
    assertEquals(typeof logger.configure, "function");
    assertEquals(typeof logger.debug, "function");
    assertEquals(typeof logger.info, "function");
    assertEquals(typeof logger.warn, "function");
    assertEquals(typeof logger.error, "function");
    assertEquals(typeof logger.getLevel, "function");
    assertEquals(typeof logger.getConfig, "function");
  });

  await t.step("should have default configuration", () => {
    const config = logger.getConfig();
    assertExists(config);
    assertEquals(typeof config.level, "number");
    assertEquals(typeof config.console, "boolean");
    assertEquals(typeof config.service, "string");
  });
});

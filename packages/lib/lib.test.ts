import { assertEquals } from "jsr:@std/assert";
import {
  createRuntimeConfig,
  DEFAULT_CONFIG,
  RuntimeAgent,
  RuntimeConfig,
} from "./mod.ts";

Deno.test("Library exports are available", () => {
  // Test that main exports are defined
  assertEquals(typeof RuntimeAgent, "function");
  assertEquals(typeof RuntimeConfig, "function");
  assertEquals(typeof createRuntimeConfig, "function");
  assertEquals(typeof DEFAULT_CONFIG, "object");
});

Deno.test("DEFAULT_CONFIG has expected values", () => {
  assertEquals(
    DEFAULT_CONFIG.syncUrl,
    "wss://anode-docworker.rgbkrk.workers.dev",
  );
});

Deno.test("RuntimeConfig validation works", () => {
  // Should throw for missing required fields
  try {
    const config = new RuntimeConfig({
      runtimeId: "test",
      runtimeType: "test",
      syncUrl: "ws://test",
      authToken: "", // Missing
      notebookId: "", // Missing
      capabilities: {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: false,
      },
    });
    config.validate();
    throw new Error("Should have thrown validation error");
  } catch (error) {
    assertEquals(
      (error as Error).message.includes("Missing required configuration"),
      true,
    );
  }

  // Should pass with all required fields
  const config = new RuntimeConfig({
    runtimeId: "test",
    runtimeType: "test",
    syncUrl: "ws://test",
    authToken: "token",
    notebookId: "notebook",
    capabilities: {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    },
  });

  // Should not throw
  config.validate();

  // Should generate session ID
  assertEquals(typeof config.sessionId, "string");
  assertEquals(config.sessionId.startsWith("test-"), true);
});

import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  getCacheConfig,
  getCacheDir,
  getEssentialPackages,
  getOnDemandPackages,
  getPreloadPackages,
  PyodideRuntimeAgent,
} from "./src/mod.ts";
import { withQuietConsole } from "../lib/test/test-config.ts";

// Configure test environment for quiet logging
Deno.env.set("RUNT_LOG_LEVEL", "ERROR");
Deno.env.set("RUNT_DISABLE_CONSOLE_LOGS", "true");

Deno.test("PyodideRuntimeAgent exports", () => {
  // Test that main exports are available
  assertEquals(typeof PyodideRuntimeAgent, "function");
  assertEquals(typeof getCacheConfig, "function");
  assertEquals(typeof getCacheDir, "function");
  assertEquals(typeof getEssentialPackages, "function");
  assertEquals(typeof getOnDemandPackages, "function");
  assertEquals(typeof getPreloadPackages, "function");
});

Deno.test("Cache utilities", async (t) => {
  await t.step("getCacheDir returns valid path", () => {
    const cacheDir = getCacheDir();
    assertEquals(typeof cacheDir, "string");
    // Should end with .runt/pyodide-cache regardless of home directory
    assertEquals(cacheDir.endsWith("/.runt/pyodide-cache"), true);
  });

  await t.step("getCacheConfig returns valid config", () => {
    const config = getCacheConfig();
    assertEquals(typeof config, "object");
    assertEquals(typeof config.packageCacheDir, "string");
    assertEquals(config.packageCacheDir, getCacheDir());
  });

  await t.step("getEssentialPackages returns array", () => {
    const packages = getEssentialPackages();
    assertEquals(Array.isArray(packages), true);
    assertEquals(packages.length > 0, true);
    // Check some expected essential packages
    assertEquals(packages.includes("numpy"), true);
    assertEquals(packages.includes("pandas"), true);
    assertEquals(packages.includes("matplotlib"), true);
    assertEquals(packages.includes("ipython"), true);
  });

  await t.step("getPreloadPackages returns subset of essential", () => {
    const preload = getPreloadPackages();
    const essential = getEssentialPackages();
    assertEquals(Array.isArray(preload), true);
    assertEquals(preload.length > 0, true);
    assertEquals(preload.length <= essential.length, true);
    // All preload packages should be in essential
    for (const pkg of preload) {
      assertEquals(essential.includes(pkg), true);
    }
  });

  await t.step("getOnDemandPackages returns array", () => {
    const onDemand = getOnDemandPackages();
    assertEquals(Array.isArray(onDemand), true);
    assertEquals(onDemand.length > 0, true);
  });

  await t.step("package lists don't overlap incorrectly", () => {
    const preload = getPreloadPackages();
    const essential = getEssentialPackages();

    // Preload should be subset of essential
    for (const pkg of preload) {
      assertEquals(essential.includes(pkg), true);
    }

    // Essential should contain all preload packages
    assertEquals(preload.every((pkg) => essential.includes(pkg)), true);
  });
});

Deno.test("PyodideRuntimeAgent configuration", async (t) => {
  await t.step("should handle missing configuration gracefully", () => {
    // This test verifies that the agent handles configuration errors
    // without crashing the test process

    const originalArgs = Deno.args;
    const originalExit = Deno.exit;
    let exitCalled = false;
    let exitCode = 0;

    try {
      // Mock Deno.exit to prevent actual exit
      Deno.exit = (code?: number) => {
        exitCalled = true;
        exitCode = code || 0;
        throw new Error("Exit called"); // Throw to stop execution
      };

      // Clear args to force configuration error
      Object.defineProperty(Deno, "args", { value: [], writable: true });

      try {
        // Wrap configuration error in quiet console to suppress verbose output
        withQuietConsole(() => {
          new PyodideRuntimeAgent([]);
        });
      } catch (error) {
        // Should throw due to our mocked exit
        assertEquals(error instanceof Error, true);
        assertEquals(exitCalled, true);
        assertEquals(exitCode, 1);
      }
    } finally {
      // Restore original functions
      Deno.exit = originalExit;
      Object.defineProperty(Deno, "args", {
        value: originalArgs,
        writable: true,
      });
    }
  });

  await t.step("should create agent with valid configuration", () => {
    const validArgs = [
      "--kernel-id",
      "test-kernel",
      "--notebook",
      "test-notebook",
      "--auth-token",
      "test-token",
      "--sync-url",
      "ws://localhost:8787",
    ];

    const agent = new PyodideRuntimeAgent(validArgs);
    assertExists(agent);
    assertEquals(typeof agent.start, "function");
    assertEquals(typeof agent.shutdown, "function");
    assertEquals(typeof agent.keepAlive, "function");
    assertEquals(agent.config.kernelType, "python3-pyodide");
    assertEquals(agent.config.capabilities.canExecuteCode, true);
    assertEquals(agent.config.capabilities.canExecuteSql, false);
    assertEquals(agent.config.capabilities.canExecuteAi, true);
  });

  await t.step("should have correct kernel type and capabilities", () => {
    const validArgs = [
      "--kernel-id",
      "test-kernel",
      "--notebook",
      "test-notebook",
      "--auth-token",
      "test-token",
    ];

    const agent = new PyodideRuntimeAgent(validArgs);
    assertEquals(agent.config.kernelType, "python3-pyodide");
    assertEquals(agent.config.capabilities.canExecuteCode, true);
    assertEquals(agent.config.capabilities.canExecuteSql, false);
    assertEquals(agent.config.capabilities.canExecuteAi, true);
  });
});

Deno.test("PyodideRuntimeAgent lifecycle", async (t) => {
  let agent: PyodideRuntimeAgent;

  const validArgs = [
    "--kernel-id",
    "test-lifecycle-kernel",
    "--notebook",
    "test-notebook",
    "--auth-token",
    "test-token",
    "--sync-url",
    "ws://localhost:8787",
  ];

  await t.step("should create agent", () => {
    agent = new PyodideRuntimeAgent(validArgs);
    assertExists(agent);
  });

  await t.step("should shutdown without starting", async () => {
    // Should be safe to shutdown without starting
    await agent.shutdown();
  });

  await t.step("should handle multiple shutdowns", async () => {
    // Multiple shutdowns should be safe
    await agent.shutdown();
    await agent.shutdown();
  });
});

// Note: Full integration tests with actual Pyodide execution would require
// a more complex setup and longer execution times. These basic tests verify
// the agent structure and configuration handling.

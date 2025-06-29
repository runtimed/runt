// Simple Integration Test for PyodideRuntimeAgent
//
// This test focuses only on what can be tested cleanly without fighting
// the type system or using type assertions.

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "jsr:@std/assert";
import { PyodideRuntimeAgent } from "../src/pyodide-agent.ts";

Deno.test("PyodideRuntimeAgent - Basic Functionality", async (t) => {
  await t.step("creates agent with valid configuration", () => {
    const agentArgs = [
      "--kernel-id",
      "test-kernel",
      "--notebook",
      "test-notebook",
      "--auth-token",
      "test-token",
    ];

    const agent = new PyodideRuntimeAgent(agentArgs);

    assertExists(agent);
    assertEquals(agent.config.kernelType, "python3-pyodide");
    assertEquals(agent.config.kernelId, "test-kernel");
    assertEquals(agent.config.notebookId, "test-notebook");
    assertEquals(agent.config.authToken, "test-token");
    assertEquals(agent.config.capabilities.canExecuteCode, true);
    assertEquals(agent.config.capabilities.canExecuteSql, false);
    assertEquals(agent.config.capabilities.canExecuteAi, true);
  });

  await t.step("generates unique session IDs", () => {
    const agentArgs = [
      "--kernel-id",
      "test-kernel",
      "--notebook",
      "test-notebook",
      "--auth-token",
      "test-token",
    ];

    const agent1 = new PyodideRuntimeAgent(agentArgs);
    const agent2 = new PyodideRuntimeAgent(agentArgs);

    assertExists(agent1.config.sessionId);
    assertExists(agent2.config.sessionId);
    assertEquals(agent1.config.sessionId !== agent2.config.sessionId, true);
    assertEquals(typeof agent1.config.sessionId, "string");
    assertEquals(agent1.config.sessionId.length > 0, true);
  });

  await t.step("handles shutdown gracefully", async () => {
    const agentArgs = [
      "--kernel-id",
      "test-kernel",
      "--notebook",
      "test-notebook",
      "--auth-token",
      "test-token",
    ];

    const agent = new PyodideRuntimeAgent(agentArgs);

    // Should shutdown without starting
    await agent.shutdown();

    // Multiple shutdowns should be safe
    await agent.shutdown();
    await agent.shutdown();
  });

  await t.step("validates configuration requirements", () => {
    const originalExit = Deno.exit;
    let exitCalled = false;

    try {
      Deno.exit = () => {
        exitCalled = true;
        throw new Error("Exit called");
      };

      try {
        new PyodideRuntimeAgent([]);
      } catch (error) {
        assertEquals(exitCalled, true);
        assertEquals(error instanceof Error, true);
      }
    } finally {
      Deno.exit = originalExit;
    }
  });
});

Deno.test("PyodideRuntimeAgent - Configuration", async (t) => {
  await t.step("accepts heartbeat interval", () => {
    const agentArgs = [
      "--kernel-id",
      "config-test-kernel",
      "--notebook",
      "config-test-notebook",
      "--auth-token",
      "config-test-token",
      "--heartbeat-interval",
      "5000",
    ];

    const agent = new PyodideRuntimeAgent(agentArgs);

    assertEquals(agent.config.heartbeatInterval, 5000);
  });

  await t.step("uses default values", () => {
    const agentArgs = [
      "--kernel-id",
      "default-test-kernel",
      "--notebook",
      "default-test-notebook",
      "--auth-token",
      "default-test-token",
    ];

    const agent = new PyodideRuntimeAgent(agentArgs);

    assertStringIncludes(agent.config.syncUrl, "anode-docworker");
    assertEquals(agent.config.heartbeatInterval, 15000);
  });

  await t.step("supports environment variables", () => {
    Deno.env.set("KERNEL_ID", "env-kernel");
    Deno.env.set("NOTEBOOK_ID", "env-notebook");
    Deno.env.set("AUTH_TOKEN", "env-token");

    try {
      const agent = new PyodideRuntimeAgent([]);

      assertEquals(agent.config.kernelId, "env-kernel");
      assertEquals(agent.config.notebookId, "env-notebook");
      assertEquals(agent.config.authToken, "env-token");
    } finally {
      Deno.env.delete("KERNEL_ID");
      Deno.env.delete("NOTEBOOK_ID");
      Deno.env.delete("AUTH_TOKEN");
    }
  });
});

Deno.test("PyodideRuntimeAgent - Methods", async (t) => {
  let agent: PyodideRuntimeAgent;

  await t.step("setup", () => {
    const agentArgs = [
      "--kernel-id",
      "method-test-kernel",
      "--notebook",
      "method-test-notebook",
      "--auth-token",
      "method-test-token",
    ];
    agent = new PyodideRuntimeAgent(agentArgs);
  });

  await t.step("has required methods", () => {
    assertEquals(typeof agent.start, "function");
    assertEquals(typeof agent.shutdown, "function");
    assertEquals(typeof agent.keepAlive, "function");
  });

  await t.step("has accessible configuration", () => {
    assertExists(agent.config);
    assertEquals(typeof agent.config, "object");
    assertExists(agent.config.kernelId);
    assertExists(agent.config.kernelType);
    assertExists(agent.config.notebookId);
    assertExists(agent.config.sessionId);
    assertExists(agent.config.capabilities);
  });
});

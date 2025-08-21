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
import { withQuietConsole } from "../../lib/test/test-config.ts";

Deno.test("PyodideRuntimeAgent - Basic Functionality", async (t) => {
  await t.step("creates agent with valid configuration", () => {
    const agentArgs = [
      "--runtime-id",
      "test-runtime",
      "--notebook",
      "test-notebook",
      "--auth-token",
      "test-token",
    ];

    const agent = PyodideRuntimeAgent.createForTesting(agentArgs);

    assertExists(agent);
    assertEquals(agent.config.runtimeType, "python3-pyodide");
    assertEquals(agent.config.runtimeId, "test-runtime");
    assertEquals(agent.config.notebookId, "test-notebook");
    assertEquals(agent.config.authToken, "test-token");
    assertEquals(agent.config.capabilities.canExecuteCode, true);
    assertEquals(agent.config.capabilities.canExecuteSql, false);
    assertEquals(agent.config.capabilities.canExecuteAi, true);
  });

  await t.step("generates unique session IDs", () => {
    const agentArgs = [
      "--runtime-id",
      "test-runtime",
      "--notebook",
      "test-notebook",
      "--auth-token",
      "test-token",
    ];

    const agent1 = PyodideRuntimeAgent.createForTesting(agentArgs);
    const agent2 = PyodideRuntimeAgent.createForTesting(agentArgs);

    assertExists(agent1.config.sessionId);
    assertExists(agent2.config.sessionId);
    assertEquals(agent1.config.sessionId !== agent2.config.sessionId, true);
    assertEquals(typeof agent1.config.sessionId, "string");
    assertEquals(agent1.config.sessionId.length > 0, true);
  });

  await t.step("handles shutdown gracefully", async () => {
    const agentArgs = [
      "--runtime-id",
      "test-runtime",
      "--notebook",
      "test-notebook",
      "--auth-token",
      "test-token",
    ];

    const agent = PyodideRuntimeAgent.createForTesting(agentArgs);

    // Should shutdown without starting
    await agent.shutdown();

    // Multiple shutdowns should be safe
    await agent.shutdown();
    await agent.shutdown();
  });

  await t.step("validates configuration requirements", () => {
    const originalExit = Deno.exit;
    const originalEnv = {
      NOTEBOOK_ID: Deno.env.get("NOTEBOOK_ID"),
      RUNT_API_KEY: Deno.env.get("RUNT_API_KEY"),
      AUTH_TOKEN: Deno.env.get("AUTH_TOKEN"),
      RUNTIME_ID: Deno.env.get("RUNTIME_ID"),
    };
    let exitCalled = false;

    try {
      // Clear environment variables to force configuration error
      Deno.env.delete("NOTEBOOK_ID");
      Deno.env.delete("RUNT_API_KEY");
      Deno.env.delete("AUTH_TOKEN");
      Deno.env.delete("RUNTIME_ID");

      Deno.exit = () => {
        exitCalled = true;
        throw new Error("Exit called");
      };

      try {
        withQuietConsole(() => {
          PyodideRuntimeAgent.createForTesting([]);
        });
      } catch (error) {
        assertEquals(exitCalled, true);
        assertEquals(error instanceof Error, true);
      }
    } finally {
      Deno.exit = originalExit;
      // Restore environment variables
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value !== undefined) {
          Deno.env.set(key, value);
        }
      }
    }
  });
});

Deno.test("PyodideRuntimeAgent - Configuration", async (t) => {
  await t.step("accepts heartbeat interval", () => {
    const agentArgs = [
      "--runtime-id",
      "config-test-runtime",
      "--notebook",
      "config-test-notebook",
      "--auth-token",
      "config-test-token",
      "--heartbeat-interval",
      "5000",
    ];

    const _agent = PyodideRuntimeAgent.createForTesting(agentArgs);
  });

  await t.step("uses default values", () => {
    const agentArgs = [
      "--runtime-id",
      "default-test-runtime",
      "--notebook",
      "default-test-notebook",
      "--auth-token",
      "default-test-token",
    ];

    const agent = PyodideRuntimeAgent.createForTesting(agentArgs);

    assertStringIncludes(agent.config.syncUrl, "anode-docworker");
  });

  await t.step("supports environment variables", () => {
    Deno.env.set("RUNTIME_ID", "env-runtime");
    Deno.env.set("NOTEBOOK_ID", "env-notebook");
    Deno.env.set("AUTH_TOKEN", "env-token");

    try {
      const agent = PyodideRuntimeAgent.createForTesting([]);

      assertEquals(agent.config.runtimeId, "env-runtime");
      assertEquals(agent.config.notebookId, "env-notebook");
      assertEquals(agent.config.authToken, "env-token");
    } finally {
      Deno.env.delete("RUNTIME_ID");
      Deno.env.delete("NOTEBOOK_ID");
      Deno.env.delete("AUTH_TOKEN");
    }
  });

  await t.step("prioritizes RUNT_API_KEY over AUTH_TOKEN", () => {
    Deno.env.set("RUNTIME_ID", "env-runtime");
    Deno.env.set("NOTEBOOK_ID", "env-notebook");
    Deno.env.set("AUTH_TOKEN", "fallback-token");
    Deno.env.set("RUNT_API_KEY", "api-key-token");

    try {
      const agent = PyodideRuntimeAgent.createForTesting([]);

      assertEquals(agent.config.runtimeId, "env-runtime");
      assertEquals(agent.config.notebookId, "env-notebook");
      assertEquals(agent.config.authToken, "api-key-token"); // Should use RUNT_API_KEY
    } finally {
      Deno.env.delete("RUNTIME_ID");
      Deno.env.delete("NOTEBOOK_ID");
      Deno.env.delete("AUTH_TOKEN");
      Deno.env.delete("RUNT_API_KEY");
    }
  });
});

Deno.test("PyodideRuntimeAgent - Methods", async (t) => {
  let agent: PyodideRuntimeAgent;

  await t.step("setup", () => {
    const agentArgs = [
      "--runtime-id",
      "method-test-runtime",
      "--notebook",
      "method-test-notebook",
      "--auth-token",
      "method-test-token",
    ];
    agent = PyodideRuntimeAgent.createForTesting(agentArgs);
  });

  await t.step("has required methods", () => {
    assertEquals(typeof agent.start, "function");
    assertEquals(typeof agent.shutdown, "function");
    assertEquals(typeof agent.keepAlive, "function");
  });

  await t.step("has accessible configuration", () => {
    assertExists(agent.config);
    assertEquals(typeof agent.config, "object");
    assertExists(agent.config.runtimeId);
    assertExists(agent.config.runtimeType);
    assertExists(agent.config.notebookId);
    assertExists(agent.config.sessionId);
    assertExists(agent.config.capabilities);
  });
});

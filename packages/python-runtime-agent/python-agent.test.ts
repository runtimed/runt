import { assertEquals, assertExists } from "jsr:@std/assert";
import { PythonRuntimeAgent } from "./src/mod.ts";

Deno.test("PythonRuntimeAgent exports", () => {
  assertEquals(typeof PythonRuntimeAgent, "function");
});

Deno.test("PythonRuntimeAgent configuration", async (t) => {
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
    const agent = new PythonRuntimeAgent(validArgs);
    assertExists(agent);
    assertEquals(typeof agent.start, "function");
    assertEquals(typeof agent.shutdown, "function");
    assertEquals(typeof agent.keepAlive, "function");
    assertEquals(agent.config.runtimeType, "python");
    assertEquals(agent.config.capabilities.canExecuteCode, true);
    assertEquals(agent.config.capabilities.canExecuteSql, false);
    assertEquals(agent.config.capabilities.canExecuteAi, true);
  });
});

Deno.test("PythonRuntimeAgent lifecycle", async (t) => {
  let agent: PythonRuntimeAgent;
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
    agent = new PythonRuntimeAgent(validArgs);
    assertExists(agent);
  });

  await t.step("should shutdown without starting", async () => {
    await agent.shutdown();
  });

  await t.step("should handle multiple shutdowns", async () => {
    await agent.shutdown();
    await agent.shutdown();
  });
});

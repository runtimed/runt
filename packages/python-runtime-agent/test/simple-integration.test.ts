// Simple Integration Test for PythonRuntimeAgent

import { assertEquals, assertExists } from "jsr:@std/assert";
import { PythonRuntimeAgent } from "../src/python-runtime-agent.ts";

// Helper function to cleanup store connections and prevent interval leaks
async function cleanupStore(agent: PythonRuntimeAgent): Promise<void> {
  // Access the store and shut it down
  const store = agent.store;
  if (
    store &&
    typeof store.shutdown === "function"
  ) {
    try {
      await store.shutdown();
    } catch (error) {
      // Ignore cleanup errors
      console.warn("Store cleanup warning:", error);
    }
  }
}

Deno.test("PythonRuntimeAgent - Basic Functionality (Stub)", async (t) => {
  const env = {
    RUNTIME_ID: "test-runtime",
    NOTEBOOK_ID: "test-notebook",
    RUNT_API_KEY: "test-token",
  };
  for (const [k, v] of Object.entries(env)) {
    Deno.env.set(k, v);
  }
  try {
    await t.step("can be constructed with minimal args", async () => {
      const agent = await PythonRuntimeAgent.create([]);
      try {
        assertExists(agent);
      } finally {
        await agent.shutdown();
        await cleanupStore(agent);
      }
    });

    await t.step("exposes required methods (stub)", async () => {
      const agent = await PythonRuntimeAgent.create([]);
      try {
        assertEquals(typeof agent.start, "function");
        assertEquals(typeof agent.shutdown, "function");
        assertEquals(typeof agent.keepAlive, "function");
      } finally {
        await agent.shutdown();
        await cleanupStore(agent);
      }
    });

    await t.step("has a config property (stub)", async () => {
      const agent = await PythonRuntimeAgent.create([
        "--notebook",
        "test-notebook",
        "--auth-token",
        "test-token",
      ]);
      try {
        assertExists(agent.config);
      } finally {
        await agent.shutdown();
        await cleanupStore(agent);
      }
    });
  } finally {
    for (const k of Object.keys(env)) {
      Deno.env.delete(k);
    }
  }
});

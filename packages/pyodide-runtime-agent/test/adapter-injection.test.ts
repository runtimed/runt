/// <reference lib="deno.ns" />
// PyodideRuntimeAgent adapter injection tests
//
// These tests verify the new adapter/store injection functionality
// that allows passing custom LiveStore adapters and stores to PyodideRuntimeAgent.

import { assertEquals, assertExists } from "jsr:@std/assert";
import { delay } from "jsr:@std/async/delay";
import { crypto } from "jsr:@std/crypto";

import { PyodideRuntimeAgent } from "../src/pyodide-agent.ts";
import type { RuntimeAgentConstructorOptions } from "@runt/lib";
import {
  createStorePromise,
  makeSchema,
  State,
} from "npm:@livestore/livestore";
import { makeAdapter } from "npm:@livestore/adapter-node";
import { events, materializers, tables } from "@runt/schema";

// Create schema locally (same as runtime-agent.ts)
const state = State.SQLite.makeState({ tables, materializers });
const schema = makeSchema({ events, state });

// Configure test environment for quiet logging
Deno.env.set("RUNT_LOG_LEVEL", "ERROR");
Deno.env.set("RUNT_DISABLE_CONSOLE_LOGS", "true");

Deno.test({
  name: "PyodideRuntimeAgent adapter injection",
  sanitizeOps: false, // Agent uses signal handlers
  sanitizeResources: false, // Agent creates background processes
  ignore: Deno.env.get("CI") === "true", // Skip in CI due to Pyodide WASM compatibility
}, async (t) => {
  await t.step(
    "should work with default adapter (backward compatibility)",
    () => {
      const notebookId = `test-${crypto.randomUUID()}`;
      const runtimeId = `runtime-${crypto.randomUUID()}`;

      const args = [
        "--notebook",
        notebookId,
        "--runtime-id",
        runtimeId,
        "--auth-token",
        "test-token",
        "--sync-url",
        "ws://fake-url:9999", // Will fail but that's expected for backward compatibility
      ];

      // Test existing constructor signature - should work exactly as before
      const agent = new PyodideRuntimeAgent(args);

      assertExists(agent);
      assertEquals(agent.config.notebookId, notebookId);
      assertEquals(agent.config.runtimeId, runtimeId);

      // Test constructor with pyodide options (existing pattern)
      const agentWithOptions = new PyodideRuntimeAgent(args, {
        packages: ["numpy"],
        discoverAiModels: false,
      });

      assertExists(agentWithOptions);
      assertEquals(agentWithOptions.config.notebookId, notebookId);
    },
  );

  await t.step("should accept custom in-memory adapter", async () => {
    const notebookId = `adapter-test-${crypto.randomUUID()}`;
    const runtimeId = `runtime-${crypto.randomUUID()}`;

    const args = [
      "--notebook",
      notebookId,
      "--runtime-id",
      runtimeId,
      "--auth-token",
      "test-token",
      // No sync-url needed with custom adapter!
    ];

    // Create custom in-memory adapter
    const adapter = makeAdapter({
      storage: { type: "in-memory" },
      // No sync backend needed for pure in-memory testing
    });

    const runtimeOptions: RuntimeAgentConstructorOptions = {
      adapter,
      clientId: "test-client-123",
    };

    const agent = new PyodideRuntimeAgent(
      args,
      { discoverAiModels: false }, // pyodide options
      runtimeOptions, // NEW: runtime options with adapter
    );

    assertExists(agent);
    assertEquals(agent.config.notebookId, notebookId);

    // Test that we can start with custom adapter
    // This should be much faster than network-dependent startup
    const startTime = performance.now();
    await agent.start();
    const startupTime = performance.now() - startTime;

    // Verify store is available
    assertExists(agent.store);

    // PyodideRuntimeAgent startup includes Pyodide WASM initialization (under 10 seconds)
    assertEquals(startupTime < 10000, true, `Startup took ${startupTime}ms`);

    await agent.shutdown();
  });

  await t.step("should accept pre-configured store", async () => {
    const notebookId = `store-test-${crypto.randomUUID()}`;

    // Create pre-configured store with some initial data
    const adapter = makeAdapter({
      storage: { type: "in-memory" },
    });

    const store = await createStorePromise({
      adapter,
      schema,
      storeId: notebookId,
    });

    // Pre-populate store with notebook data
    store.commit(events.notebookInitialized({
      id: notebookId,
      title: "Pre-configured Test Notebook",
      ownerId: "test-user",
    }));

    const args = [
      "--notebook",
      notebookId,
      "--auth-token",
      "test-token",
    ];

    const runtimeOptions: RuntimeAgentConstructorOptions = {
      store,
    };

    const agent = new PyodideRuntimeAgent(
      args,
      { discoverAiModels: false },
      runtimeOptions,
    );

    await agent.start();

    // Verify it's using our pre-configured store
    assertEquals(agent.store, store);

    // Verify pre-existing data is available through notebook metadata
    const metadata = agent.store.query(tables.notebookMetadata);
    assertEquals(metadata.length > 0, true, "Should have notebook metadata");

    // Agent shutdown shouldn't shutdown the custom store
    await agent.shutdown();

    // Store should still be available
    assertExists(store);

    // Clean up the store ourselves
    await store.shutdown();
  });

  await t.step(
    "should work with mixed pyodide and runtime options",
    async () => {
      const notebookId = `mixed-test-${crypto.randomUUID()}`;
      const runtimeId = `runtime-${crypto.randomUUID()}`;

      const args = [
        "--notebook",
        notebookId,
        "--runtime-id",
        runtimeId,
        "--auth-token",
        "test-token",
      ];

      const adapter = makeAdapter({
        storage: { type: "in-memory" },
      });

      const agent = new PyodideRuntimeAgent(
        args,
        {
          // Pyodide-specific options
          packages: ["numpy", "pandas"],
          discoverAiModels: false,
          mountReadonly: true,
        },
        {
          // Runtime options
          adapter,
          clientId: "mixed-test-client",
        },
      );

      await agent.start();

      // Verify both pyodide and runtime options took effect
      assertExists(agent.store);
      assertEquals(agent["pyodideOptions"].packages, ["numpy", "pandas"]);
      assertEquals(agent["pyodideOptions"].discoverAiModels, false);
      assertEquals(agent["pyodideOptions"].mountReadonly, true);

      await agent.shutdown();
    },
  );

  await t.step(
    "should handle multiple PyodideRuntimeAgents with shared store",
    async () => {
      const notebookId = `shared-${crypto.randomUUID()}`;

      // Create shared store
      const adapter = makeAdapter({
        storage: { type: "in-memory" },
      });

      const sharedStore = await createStorePromise({
        adapter,
        schema,
        storeId: notebookId,
      });

      // Initialize shared notebook
      sharedStore.commit(events.notebookInitialized({
        id: notebookId,
        title: "Shared Test Notebook",
        ownerId: "test-user",
      }));

      // Create two PyodideRuntimeAgents sharing the same store
      const agent1 = new PyodideRuntimeAgent(
        [
          "--notebook",
          notebookId,
          "--runtime-id",
          "agent-1",
          "--auth-token",
          "token1",
        ],
        { discoverAiModels: false },
        { store: sharedStore },
      );

      const agent2 = new PyodideRuntimeAgent(
        [
          "--notebook",
          notebookId,
          "--runtime-id",
          "agent-2",
          "--auth-token",
          "token2",
        ],
        { discoverAiModels: false },
        { store: sharedStore },
      );

      await agent1.start();
      await agent2.start();

      // Both agents should have the same store instance
      assertEquals(agent1.store, sharedStore);
      assertEquals(agent2.store, sharedStore);
      assertEquals(agent1.store, agent2.store);

      // Both should see the same shared store data
      assertEquals(agent1.store, agent2.store);
      const metadata1 = agent1.store.query(tables.notebookMetadata);
      const metadata2 = agent2.store.query(tables.notebookMetadata);
      assertEquals(metadata1.length, metadata2.length);

      await agent1.shutdown();
      await agent2.shutdown();

      // Shared store should still be available
      assertExists(sharedStore);

      await sharedStore.shutdown();
    },
  );

  await t.step(
    "should demonstrate performance benefit of in-memory adapter",
    async () => {
      const iterations = 3;
      const inMemoryTimes: number[] = [];

      // Test in-memory adapter startup times
      for (let i = 0; i < iterations; i++) {
        const adapter = makeAdapter({
          storage: { type: "in-memory" },
        });

        const agent = new PyodideRuntimeAgent(
          [`--notebook`, `perf-test-${i}`, "--auth-token", "test"],
          { discoverAiModels: false },
          { adapter, clientId: `perf-client-${i}` },
        );

        const startTime = performance.now();
        await agent.start();
        const endTime = performance.now();

        inMemoryTimes.push(endTime - startTime);

        await agent.shutdown();
      }

      const avgTime = inMemoryTimes.reduce((a, b) => a + b, 0) / iterations;

      // PyodideRuntimeAgent with in-memory should be reasonably fast (under 10 seconds on average)
      assertEquals(
        avgTime < 10000,
        true,
        `Average startup time: ${avgTime.toFixed(2)}ms`,
      );

      // Times should be relatively consistent (standard deviation under 3 seconds for Pyodide)
      const stdDev = Math.sqrt(
        inMemoryTimes.reduce(
          (sum, time) => sum + Math.pow(time - avgTime, 2),
          0,
        ) / iterations,
      );
      assertEquals(
        stdDev < 3000,
        true,
        `Startup times should be consistent (stddev: ${stdDev.toFixed(2)}ms)`,
      );

      console.log(
        `✅ In-memory adapter performance: ${avgTime.toFixed(2)}ms ± ${
          stdDev.toFixed(2)
        }ms`,
      );
    },
  );

  await t.step(
    "should maintain backward compatibility for all existing patterns",
    () => {
      // Pattern 1: Basic constructor
      const agent1 = new PyodideRuntimeAgent([
        "--notebook",
        "compat-test-1",
        "--auth-token",
        "token",
      ]);
      assertExists(agent1);

      // Pattern 2: Constructor with pyodide options
      const agent2 = new PyodideRuntimeAgent(
        ["--notebook", "compat-test-2", "--auth-token", "token"],
        { packages: ["numpy"] },
      );
      assertExists(agent2);

      // Pattern 3: Empty options (should use defaults)
      const agent3 = new PyodideRuntimeAgent(
        ["--notebook", "compat-test-3", "--auth-token", "token"],
        {},
        {},
      );
      assertExists(agent3);

      // All existing patterns should work without changes
      assertEquals(agent1.config.notebookId, "compat-test-1");
      assertEquals(agent2.config.notebookId, "compat-test-2");
      assertEquals(agent3.config.notebookId, "compat-test-3");
    },
  );
});

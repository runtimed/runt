/// <reference lib="deno.ns" />
// PyodideRuntimeAgent adapter injection tests
//
// These tests verify the new adapter/store injection functionality
// that allows passing custom LiveStore adapters and stores to PyodideRuntimeAgent.

import { assertEquals, assertExists } from "jsr:@std/assert";

import { crypto } from "jsr:@std/crypto";

import { PyodideRuntimeAgent } from "../src/pyodide-agent.ts";

import { makeAdapter } from "npm:@livestore/adapter-node";
import { makeInMemoryAdapter } from "npm:@livestore/adapter-web";
import {
  createRuntimeSyncPayload,
  createStorePromise,
} from "@runtimed/agent-core";

// Configure test environment for quiet logging
Deno.env.set("RUNT_LOG_LEVEL", "ERROR");
Deno.env.set("RUNT_DISABLE_CONSOLE_LOGS", "true");

Deno.test({
  name: "PyodideRuntimeAgent adapter injection",
  sanitizeOps: false, // Agent uses signal handlers
  sanitizeResources: false, // Agent creates background processes
  ignore: true, // Disabled - tests outdated adapter injection pattern
}, async (t) => {
  await t.step(
    "should work with default adapter (backward compatibility)",
    async () => {
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

      // Create store for new constructor signature
      const adapter = makeInMemoryAdapter({});
      const syncPayload = createRuntimeSyncPayload({
        authToken: "test-token",
        runtimeId,
        sessionId: crypto.randomUUID(),
        userId: "test-user-id",
      });
      const store = await createStorePromise({
        adapter,
        notebookId,
        syncPayload,
      });

      // Test new constructor signature with store
      const agent = new PyodideRuntimeAgent(args, {}, { store });

      assertExists(agent);
      assertEquals(agent.config.notebookId, notebookId);
      assertEquals(agent.config.runtimeId, runtimeId);

      // Test constructor with pyodide options
      const agentWithOptions = new PyodideRuntimeAgent(args, {
        packages: ["numpy"],
        discoverAiModels: false,
      }, { store });

      assertExists(agentWithOptions);
      assertEquals(agentWithOptions.config.notebookId, notebookId);
    },
  );

  await t.step("should accept custom in-memory adapter", async () => {
    const notebookId = `adapter-test-${crypto.randomUUID()}`;
    const runtimeId = `runtime-${crypto.randomUUID()}`;

    // Create custom in-memory adapter
    const adapter = makeAdapter({
      storage: { type: "in-memory" },
      // No sync backend needed for pure in-memory testing
    });

    const agent = new PyodideRuntimeAgent(
      [
        "--notebook",
        notebookId,
        "--runtime-id",
        runtimeId,
        "--auth-token",
        "test-token",
        // No sync-url needed with custom adapter!
      ],
      { discoverAiModels: false }, // pyodide options
      {
        adapter,
        store: await createStorePromise({
          adapter,
          notebookId,
          syncPayload: createRuntimeSyncPayload({
            authToken: "test-token",
            runtimeId,
            sessionId: crypto.randomUUID(),
            userId: "test-user-id",
          }),
        }),
      }, // runtime options
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

  await t.step(
    "should accept custom adapter",
    async () => {
      const notebookId = `adapter-test-${crypto.randomUUID()}`;

      // Create adapter - LiveStore will handle clientId internally
      const adapter = makeAdapter({
        storage: { type: "in-memory" },
      });

      const agent = new PyodideRuntimeAgent(
        [
          "--notebook",
          notebookId,
          "--auth-token",
          "test-token",
        ],
        { discoverAiModels: false },
        {
          adapter,
          store: await createStorePromise({
            adapter,
            notebookId,
            syncPayload: createRuntimeSyncPayload({
              authToken: "test-token",
              runtimeId: crypto.randomUUID(),
              sessionId: crypto.randomUUID(),
              userId: "test-user-id",
            }),
          }),
        },
      );

      await agent.start();

      // Verify store was created successfully
      assertExists(agent.store);

      await agent.shutdown();
    },
  );

  await t.step(
    "should work with mixed pyodide and runtime options",
    async () => {
      const notebookId = `mixed-test-${crypto.randomUUID()}`;
      const runtimeId = `runtime-${crypto.randomUUID()}`;

      const adapter = makeAdapter({
        storage: { type: "in-memory" },
      });

      const agent = new PyodideRuntimeAgent(
        [
          "--notebook",
          notebookId,
          "--runtime-id",
          runtimeId,
          "--auth-token",
          "test-token",
        ],
        {
          // Pyodide-specific options
          packages: ["numpy", "pandas"],
          discoverAiModels: false,
          mountReadonly: true,
        },
        {
          adapter,
          store: await createStorePromise({
            adapter,
            notebookId: notebookId,
            syncPayload: createRuntimeSyncPayload({
              authToken: "test-token",
              runtimeId: runtimeId,
              sessionId: crypto.randomUUID(),
              userId: "test-user-id",
            }),
          }),
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
    "should handle multiple PyodideRuntimeAgents with same adapter",
    async () => {
      const adapter = makeAdapter({
        storage: { type: "in-memory" },
      });

      // Create two PyodideRuntimeAgents using the same adapter
      const agent1 = new PyodideRuntimeAgent(
        [
          "--notebook",
          `shared-1-${crypto.randomUUID()}`,
          "--runtime-id",
          "agent-1",
          "--auth-token",
          "token1",
        ],
        { discoverAiModels: false },
        {
          adapter,
          store: await createStorePromise({
            adapter,
            notebookId: `shared-1-${crypto.randomUUID()}`,
            syncPayload: createRuntimeSyncPayload({
              authToken: "test-token",
              runtimeId: "agent-1",
              sessionId: crypto.randomUUID(),
              userId: "test-user-id",
            }),
          }),
        },
      );

      const agent2 = new PyodideRuntimeAgent(
        [
          "--notebook",
          `shared-2-${crypto.randomUUID()}`,
          "--runtime-id",
          "agent-2",
          "--auth-token",
          "token2",
        ],
        { discoverAiModels: false },
        {
          adapter,
          store: await createStorePromise({
            adapter,
            notebookId: `shared-2-${crypto.randomUUID()}`,
            syncPayload: createRuntimeSyncPayload({
              authToken: "test-token",
              runtimeId: "agent-2",
              sessionId: crypto.randomUUID(),
              userId: "test-user-id",
            }),
          }),
        },
      );

      await agent1.start();
      await agent2.start();

      // Both agents should have their own stores
      assertExists(agent1.store);
      assertExists(agent2.store);

      await agent1.shutdown();
      await agent2.shutdown();
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
          {
            adapter,
            store: await createStorePromise({
              adapter,
              notebookId: `perf-test-${i}`,
              syncPayload: createRuntimeSyncPayload({
                authToken: "test-token",
                runtimeId: crypto.randomUUID(),
                sessionId: crypto.randomUUID(),
                userId: "test-user-id",
              }),
            }),
          },
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
    "should support programmatic usage (LiveStore handles clientId)",
    async () => {
      // Note: CLI usage (import.meta.main in mod.ts) handles auth first,
      // but programmatic usage works with LiveStore managing clientId

      // Pattern 1: Constructor without explicit clientId
      const agent1 = new PyodideRuntimeAgent(
        [
          "--notebook",
          "programmatic-test-1",
          "--auth-token",
          "token",
        ],
        {}, // pyodide options
        {
          store: await createStorePromise({
            adapter: makeInMemoryAdapter({}),
            notebookId: "programmatic-test-1",
            syncPayload: createRuntimeSyncPayload({
              authToken: "test-token",
              runtimeId: crypto.randomUUID(),
              sessionId: crypto.randomUUID(),
              userId: "test-user-id",
            }),
          }),
        },
      );

      assertExists(agent1);

      // Pattern 2: Constructor with pyodide options
      const agent2 = new PyodideRuntimeAgent(
        ["--notebook", "programmatic-test-2", "--auth-token", "token"],
        { packages: ["numpy"] }, // pyodide options
        {
          store: await createStorePromise({
            adapter: makeInMemoryAdapter({}),
            notebookId: "programmatic-test-2",
            syncPayload: createRuntimeSyncPayload({
              authToken: "test-token",
              runtimeId: crypto.randomUUID(),
              sessionId: crypto.randomUUID(),
              userId: "test-user-id",
            }),
          }),
        },
      );

      assertExists(agent2);

      // Verify configs are set correctly
      assertEquals(agent1.config.notebookId, "programmatic-test-1");
      assertEquals(agent2.config.notebookId, "programmatic-test-2");
    },
  );
});

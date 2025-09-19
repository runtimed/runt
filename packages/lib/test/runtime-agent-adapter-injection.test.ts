/// <reference lib="deno.ns" />
// RuntimeAgent adapter injection tests
//
// These tests verify the new adapter/store injection functionality
// that allows passing custom LiveStore adapters and stores to RuntimeAgent.

import { assertEquals, assertExists } from "jsr:@std/assert";

import { crypto } from "jsr:@std/crypto";

import {
  createRuntimeSyncPayload,
  createStorePromise,
  RuntimeAgent,
  type RuntimeAgentOptions,
  type RuntimeCapabilities,
  RuntimeConfig,
} from "@runtimed/agent-core";

import { makeInMemoryAdapter } from "npm:@livestore/adapter-web";
import { makeAdapter } from "npm:@livestore/adapter-node";

// Helper function for creating test configs with store
async function createTestRuntimeConfig(
  _args: string[],
  defaults: Partial<RuntimeAgentOptions> = {},
): Promise<RuntimeConfig> {
  // Create default in-memory adapter for testing
  const defaultAdapter = makeInMemoryAdapter({});

  // Create sync payload
  const syncPayload = createRuntimeSyncPayload({
    authToken: "test-token",
    runtimeId: "test-runtime-id",
    sessionId: crypto.randomUUID(),
    userId: "test-user-id",
  });

  // Create store
  const store = await createStorePromise({
    adapter: defaultAdapter,
    notebookId: "test-notebook",
    syncPayload,
  });

  const config: RuntimeAgentOptions = {
    runtimeId: "test-runtime-id",
    runtimeType: "test-runtime",
    syncUrl: "ws://fake-url:9999",
    authToken: "test-token",
    notebookId: "test-notebook",
    userId: "test-user-id",
    store,
    capabilities: {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    },
    ...defaults,
  };

  return new RuntimeConfig(config);
}

Deno.test("RuntimeAgent adapter injection", async (t) => {
  await t.step(
    "should work with default adapter (backward compatibility)",
    async () => {
      const config = await createTestRuntimeConfig([], {
        userId: "test-user-id",
        notebookId: "test-notebook",
        syncUrl: "ws://fake-url:9999", // Will fail but that's expected
      });

      const capabilities: RuntimeCapabilities = {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: false,
      };

      const agent = new RuntimeAgent(config, capabilities);

      // Should work exactly as before - no changes needed
      assertExists(agent);
      assertEquals(agent.config.notebookId, "test-notebook");
    },
  );

  await t.step("should accept custom in-memory adapter", async () => {
    // Create custom in-memory adapter
    const adapter = makeInMemoryAdapter({
      // No sync backend needed for pure in-memory testing
    });

    // Create sync payload
    const syncPayload = createRuntimeSyncPayload({
      authToken: "test-token",
      runtimeId: "test-runtime-id",
      sessionId: crypto.randomUUID(),
      userId: "test-user-id",
    });

    // Create store with custom adapter
    const store = await createStorePromise({
      adapter,
      notebookId: "adapter-test",
      syncPayload,
    });

    const config: RuntimeAgentOptions = {
      runtimeId: "test-runtime-id",
      runtimeType: "test-runtime",
      syncUrl: "ws://fake-url:9999",
      authToken: "test-token",
      notebookId: "adapter-test",
      userId: "test-user-id",
      store,
      capabilities: {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: false,
      },
    };

    const runtimeConfig = new RuntimeConfig(config);

    const capabilities: RuntimeCapabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    };

    const agent = new RuntimeAgent(runtimeConfig, capabilities);

    assertExists(agent);
    assertEquals(agent.config.notebookId, "adapter-test");

    // Test that we can start with custom adapter (won't try to sync)
    await agent.start();

    // Verify store is available
    assertExists(agent.store);

    await agent.shutdown();
  });

  await t.step(
    "should accept custom adapter without explicit clientId",
    async () => {
      // Create custom in-memory adapter
      const adapter = makeInMemoryAdapter({});

      // Create sync payload
      const syncPayload = createRuntimeSyncPayload({
        authToken: "test-token",
        runtimeId: "test-runtime-id",
        sessionId: crypto.randomUUID(),
        userId: "test-user-id",
      });

      // Create store with custom adapter
      const store = await createStorePromise({
        adapter,
        notebookId: "adapter-test-2",
        syncPayload,
      });

      const config: RuntimeAgentOptions = {
        runtimeId: "test-runtime-id",
        runtimeType: "test-runtime",
        syncUrl: "ws://fake-url:9999",
        authToken: "test-token",
        notebookId: "adapter-test-2",
        userId: "test-user-id",
        store,
        capabilities: {
          canExecuteCode: true,
          canExecuteSql: false,
          canExecuteAi: false,
        },
      };

      const runtimeConfig = new RuntimeConfig(config);

      const capabilities: RuntimeCapabilities = {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: false,
      };

      const agent = new RuntimeAgent(runtimeConfig, capabilities);

      await agent.start();

      // Verify store was created successfully
      assertExists(agent.store);

      await agent.shutdown();
    },
  );

  await t.step("should handle multiple agents with same adapter", async () => {
    // Create shared adapter
    const adapter = makeInMemoryAdapter({});

    // Create sync payloads for each agent
    const syncPayload1 = createRuntimeSyncPayload({
      authToken: "token1",
      runtimeId: "agent-1",
      sessionId: crypto.randomUUID(),
      userId: "test-user-id",
    });

    const syncPayload2 = createRuntimeSyncPayload({
      authToken: "token2",
      runtimeId: "agent-2",
      sessionId: crypto.randomUUID(),
      userId: "test-user-id",
    });

    // Create stores with shared adapter
    const store1 = await createStorePromise({
      adapter,
      notebookId: "shared-adapter-1",
      syncPayload: syncPayload1,
    });

    const store2 = await createStorePromise({
      adapter,
      notebookId: "shared-adapter-2",
      syncPayload: syncPayload2,
    });

    // Create configs with stores
    const config1: RuntimeAgentOptions = {
      runtimeId: "agent-1",
      runtimeType: "test-runtime",
      syncUrl: "ws://fake-url:9999",
      authToken: "token1",
      notebookId: "shared-adapter-1",
      userId: "test-user-id",
      store: store1,
      capabilities: {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: false,
      },
    };

    const config2: RuntimeAgentOptions = {
      runtimeId: "agent-2",
      runtimeType: "test-runtime",
      syncUrl: "ws://fake-url:9999",
      authToken: "token2",
      notebookId: "shared-adapter-2",
      userId: "test-user-id",
      store: store2,
      capabilities: {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: false,
      },
    };

    const runtimeConfig1 = new RuntimeConfig(config1);
    const runtimeConfig2 = new RuntimeConfig(config2);

    const capabilities: RuntimeCapabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    };

    const agent1 = new RuntimeAgent(runtimeConfig1, capabilities);
    const agent2 = new RuntimeAgent(runtimeConfig2, capabilities);

    await agent1.start();
    await agent2.start();

    // Both agents should have their own stores but use same adapter type
    assertExists(agent1.store);
    assertExists(agent2.store);

    await agent1.shutdown();
    await agent2.shutdown();
  });

  await t.step("should work with file system adapter", async () => {
    // Create temporary directory for test
    const tempDir = `/tmp/runt-test-${crypto.randomUUID()}`;

    const fsAdapter = makeAdapter({
      storage: {
        type: "fs",
        baseDirectory: tempDir,
      },
    });

    // Create sync payload
    const syncPayload = createRuntimeSyncPayload({
      authToken: "test-token",
      runtimeId: "test-runtime-id",
      sessionId: crypto.randomUUID(),
      userId: "test-user-id",
    });

    // Create store with file system adapter
    const store = await createStorePromise({
      adapter: fsAdapter,
      notebookId: "fs-test",
      syncPayload,
    });

    const config: RuntimeAgentOptions = {
      runtimeId: "test-runtime-id",
      runtimeType: "test-runtime",
      syncUrl: "ws://fake-url:9999",
      authToken: "test-token",
      notebookId: "fs-test",
      userId: "test-user-id",
      store,
      capabilities: {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: false,
      },
    };

    const runtimeConfig = new RuntimeConfig(config);

    const capabilities: RuntimeCapabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    };

    const agent = new RuntimeAgent(runtimeConfig, capabilities);

    await agent.start();

    assertExists(agent.store);

    await agent.shutdown();

    // Clean up temp directory
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });
});

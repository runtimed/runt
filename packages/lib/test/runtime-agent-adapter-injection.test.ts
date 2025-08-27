/// <reference lib="deno.ns" />
// RuntimeAgent adapter injection tests
//
// These tests verify the new adapter/store injection functionality
// that allows passing custom LiveStore adapters and stores to RuntimeAgent.

import { assertEquals, assertExists } from "jsr:@std/assert";

import { crypto } from "jsr:@std/crypto";

import {
  RuntimeAgent,
  type RuntimeAgentConstructorOptions,
  type RuntimeCapabilities,
} from "@runt/lib";
import { createRuntimeConfig } from "../src/config.ts";
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

Deno.test("RuntimeAgent adapter injection", async (t) => {
  await t.step(
    "should work with default adapter (backward compatibility)",
    () => {
      const config = createRuntimeConfig([
        "--notebook",
        "test-notebook",
        "--auth-token",
        "test-token",
        "--sync-url",
        "ws://fake-url:9999", // Will fail but that's expected
      ]);

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
    const config = createRuntimeConfig([
      "--notebook",
      "adapter-test",
      "--auth-token",
      "test-token",
    ]);

    const capabilities: RuntimeCapabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    };

    // Create custom in-memory adapter
    const adapter = makeAdapter({
      storage: { type: "in-memory" },
      // No sync backend needed for pure in-memory testing
    });

    const options: RuntimeAgentConstructorOptions = {
      adapter,
      clientId: "test-client-123",
    };

    const agent = new RuntimeAgent(config, capabilities, {}, options);

    assertExists(agent);
    assertEquals(agent.config.notebookId, "adapter-test");

    // Test that we can start with custom adapter (won't try to sync)
    await agent.start();

    // Verify store is available
    assertExists(agent.store);

    await agent.shutdown();
  });

  await t.step("should accept pre-configured store", async () => {
    const config = createRuntimeConfig([
      "--notebook",
      "store-test",
      "--auth-token",
      "test-token",
    ]);

    const capabilities: RuntimeCapabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    };

    // Create pre-configured store
    const adapter = makeAdapter({
      storage: { type: "in-memory" },
    });

    const store = await createStorePromise({
      adapter,
      schema,
      storeId: "pre-configured-store",
    });

    const options: RuntimeAgentConstructorOptions = {
      store,
    };

    const agent = new RuntimeAgent(config, capabilities, {}, options);

    await agent.start();

    // Verify it's using our pre-configured store
    assertEquals(agent.store, store);

    // Agent shutdown shouldn't shutdown the custom store
    await agent.shutdown();

    // Store should still be available
    assertExists(store);

    // Clean up the store ourselves
    await store.shutdown();
  });

  await t.step("should generate clientId for custom adapter", async () => {
    const runtimeId = `runtime-${crypto.randomUUID()}`;
    const config = createRuntimeConfig([
      "--notebook",
      "clientid-test",
      "--runtime-id",
      runtimeId,
      "--auth-token",
      "test-token",
    ]);

    const capabilities: RuntimeCapabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    };

    const adapter = makeAdapter({
      storage: { type: "in-memory" },
    });

    const options: RuntimeAgentConstructorOptions = {
      adapter,
      // No explicit clientId - should generate one
    };

    const agent = new RuntimeAgent(config, capabilities, {}, options);

    await agent.start();

    // The generated clientId should be "runtime-{runtimeId}"
    // We can't directly verify this without accessing internals,
    // but we can verify the store was created successfully
    assertExists(agent.store);

    await agent.shutdown();
  });

  await t.step("should use explicit clientId when provided", async () => {
    const config = createRuntimeConfig([
      "--notebook",
      "explicit-clientid-test",
      "--auth-token",
      "test-token",
    ]);

    const capabilities: RuntimeCapabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    };

    const adapter = makeAdapter({
      storage: { type: "in-memory" },
    });

    const explicitClientId = "my-custom-client-id";

    const options: RuntimeAgentConstructorOptions = {
      adapter,
      clientId: explicitClientId,
    };

    const agent = new RuntimeAgent(config, capabilities, {}, options);

    await agent.start();

    // Store should be created successfully with custom clientId
    assertExists(agent.store);

    await agent.shutdown();
  });

  await t.step("should handle multiple agents with shared store", async () => {
    // Create shared store
    const adapter = makeAdapter({
      storage: { type: "in-memory" },
    });

    const sharedStore = await createStorePromise({
      adapter,
      schema,
      storeId: "shared-notebook",
    });

    // Create two agents sharing the same store
    const config1 = createRuntimeConfig([
      "--notebook",
      "shared-notebook",
      "--runtime-id",
      "agent-1",
      "--auth-token",
      "token1",
    ]);

    const config2 = createRuntimeConfig([
      "--notebook",
      "shared-notebook",
      "--runtime-id",
      "agent-2",
      "--auth-token",
      "token2",
    ]);

    const capabilities: RuntimeCapabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    };

    const agent1 = new RuntimeAgent(config1, capabilities, {}, {
      store: sharedStore,
    });
    const agent2 = new RuntimeAgent(config2, capabilities, {}, {
      store: sharedStore,
    });

    await agent1.start();
    await agent2.start();

    // Both agents should have the same store instance
    assertEquals(agent1.store, sharedStore);
    assertEquals(agent2.store, sharedStore);
    assertEquals(agent1.store, agent2.store);

    await agent1.shutdown();
    await agent2.shutdown();

    // Shared store should still be available
    assertExists(sharedStore);

    await sharedStore.shutdown();
  });

  await t.step(
    "should prioritize store over adapter when both provided",
    async () => {
      const config = createRuntimeConfig([
        "--notebook",
        "priority-test",
        "--auth-token",
        "test-token",
      ]);

      const capabilities: RuntimeCapabilities = {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: false,
      };

      // Create both adapter and store
      const adapter = makeAdapter({
        storage: { type: "in-memory" },
      });

      const store = await createStorePromise({
        adapter,
        schema,
        storeId: "priority-store",
      });

      const options: RuntimeAgentConstructorOptions = {
        adapter, // This should be ignored
        store, // This should take precedence
      };

      const agent = new RuntimeAgent(config, capabilities, {}, options);

      await agent.start();

      // Should use the provided store, not create one from adapter
      assertEquals(agent.store, store);

      await agent.shutdown();
      await store.shutdown();
    },
  );

  await t.step("should work with file system adapter", async () => {
    const config = createRuntimeConfig([
      "--notebook",
      "fs-test",
      "--auth-token",
      "test-token",
    ]);

    const capabilities: RuntimeCapabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    };

    // Create temporary directory for test
    const tempDir = `/tmp/runt-test-${crypto.randomUUID()}`;

    const fsAdapter = makeAdapter({
      storage: {
        type: "fs",
        baseDirectory: tempDir,
      },
    });

    const options: RuntimeAgentConstructorOptions = {
      adapter: fsAdapter,
      clientId: "fs-test-client",
    };

    const agent = new RuntimeAgent(config, capabilities, {}, options);

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

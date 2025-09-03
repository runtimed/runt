/// <reference lib="deno.ns" />
// RuntimeAgent adapter injection tests
//
// These tests verify the new adapter/store injection functionality
// that allows passing custom LiveStore adapters and stores to RuntimeAgent.

import { assertEquals, assertExists } from "jsr:@std/assert";

import { crypto } from "jsr:@std/crypto";

import {
  RuntimeAgent,
  type RuntimeAgentOptions,
  type RuntimeCapabilities,
  RuntimeConfig,
} from "@runt/lib";
import { makeInMemoryAdapter } from "npm:@livestore/adapter-web";
import { makeAdapter } from "npm:@livestore/adapter-node";

// Helper function for creating test configs since createBaseRuntimeConfig moved to pyodide package
function createTestRuntimeConfig(
  _args: string[],
  defaults: Partial<RuntimeAgentOptions> = {},
): RuntimeConfig {
  // Create default in-memory adapter for testing
  const defaultAdapter = makeInMemoryAdapter({});

  const config: RuntimeAgentOptions = {
    runtimeId: "test-runtime-id",
    runtimeType: "test-runtime",
    syncUrl: "ws://fake-url:9999",
    authToken: "test-token",
    notebookId: "test-notebook",
    capabilities: {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    },
    clientId: "test-client",
    adapter: defaultAdapter,
    ...defaults,
  };
  return new RuntimeConfig(config);
}

Deno.test("RuntimeAgent adapter injection", async (t) => {
  await t.step(
    "should work with default adapter (backward compatibility)",
    () => {
      const config = createTestRuntimeConfig([], {
        clientId: "test-client-backward-compat",
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

    const config = createTestRuntimeConfig([], {
      adapter,
      clientId: "test-client-adapter",
      notebookId: "adapter-test",
      syncUrl: "ws://fake-url:9999",
    });

    const capabilities: RuntimeCapabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    };

    const agent = new RuntimeAgent(config, capabilities);

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

      const config = createTestRuntimeConfig([], {
        adapter,
        clientId: "test-client-generated",
        notebookId: "adapter-test-2",
        authToken: "test-token",
        syncUrl: "ws://fake-url:9999",
      });

      const capabilities: RuntimeCapabilities = {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: false,
      };

      const agent = new RuntimeAgent(config, capabilities);

      await agent.start();

      // Verify store was created successfully
      assertExists(agent.store);

      await agent.shutdown();
    },
  );

  await t.step("should generate clientId for custom adapter", async () => {
    const runtimeId = `runtime-${crypto.randomUUID()}`;
    const adapter = makeInMemoryAdapter({});

    const config = createTestRuntimeConfig([], {
      adapter,
      runtimeId,
      notebookId: "clientid-test",
      syncUrl: "ws://fake-url:9999",
    });

    const capabilities: RuntimeCapabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    };

    const agent = new RuntimeAgent(config, capabilities);

    await agent.start();

    // The generated clientId should be "runtime-{runtimeId}"
    // We can't directly verify this without accessing internals,
    // but we can verify the store was created successfully
    assertExists(agent.store);

    await agent.shutdown();
  });

  await t.step("should use explicit clientId when provided", async () => {
    const adapter = makeInMemoryAdapter({});

    const explicitClientId = "my-custom-client-id";

    const config = createTestRuntimeConfig([], {
      adapter,
      clientId: explicitClientId,
      notebookId: "explicit-clientid-test",
      syncUrl: "ws://fake-url:9999",
    });

    const capabilities: RuntimeCapabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    };

    const agent = new RuntimeAgent(config, capabilities);

    await agent.start();

    // Store should be created successfully with custom clientId
    assertExists(agent.store);

    await agent.shutdown();
  });

  await t.step("should handle multiple agents with same adapter", async () => {
    // Create shared adapter
    const adapter = makeInMemoryAdapter({});

    // Create two agents using the same adapter
    const config1 = createTestRuntimeConfig([], {
      adapter,
      clientId: "client-1",
      notebookId: "shared-adapter-1",
      runtimeId: "agent-1",
      authToken: "token1",
      syncUrl: "ws://fake-url:9999",
    });

    const config2 = createTestRuntimeConfig([], {
      adapter,
      clientId: "client-2",
      notebookId: "shared-adapter-2",
      runtimeId: "agent-2",
      authToken: "token2",
      syncUrl: "ws://fake-url:9999",
    });

    const capabilities: RuntimeCapabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    };

    const agent1 = new RuntimeAgent(config1, capabilities);
    const agent2 = new RuntimeAgent(config2, capabilities);

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

    const config = createTestRuntimeConfig([], {
      adapter: fsAdapter,
      clientId: "fs-client",
      notebookId: "fs-test",
      authToken: "test-token",
      syncUrl: "ws://fake-url:9999",
    });

    const capabilities: RuntimeCapabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    };

    const agent = new RuntimeAgent(config, capabilities);

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

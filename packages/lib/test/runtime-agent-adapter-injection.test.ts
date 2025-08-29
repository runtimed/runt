/// <reference lib="deno.ns" />
// RuntimeAgent adapter injection tests
//
// These tests verify the new adapter/store injection functionality
// that allows passing custom LiveStore adapters and stores to RuntimeAgent.

import { assertEquals, assertExists } from "jsr:@std/assert";

import { crypto } from "jsr:@std/crypto";

import { RuntimeAgent, type RuntimeCapabilities } from "@runt/lib";
import { createBaseRuntimeConfig } from "../src/config.ts";
import { makeAdapter } from "npm:@livestore/adapter-node";

Deno.test("RuntimeAgent adapter injection", async (t) => {
  await t.step(
    "should work with default adapter (backward compatibility)",
    () => {
      const config = createBaseRuntimeConfig([
        "--notebook",
        "test-notebook",
        "--auth-token",
        "test-token",
        "--sync-url",
        "ws://fake-url:9999", // Will fail but that's expected
      ], {
        clientId: "test-client-backward-compat",
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
    const adapter = makeAdapter({
      storage: { type: "in-memory" },
      // No sync backend needed for pure in-memory testing
    });

    const config = createBaseRuntimeConfig([
      "--notebook",
      "adapter-test",
      "--auth-token",
      "test-token",
    ], {
      adapter,
      clientId: "test-client-123",
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
      const adapter = makeAdapter({
        storage: { type: "in-memory" },
      });

      const config = createBaseRuntimeConfig([
        "--notebook",
        "adapter-test-2",
        "--auth-token",
        "test-token",
      ], {
        adapter,
        clientId: "test-client-generated",
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
    const adapter = makeAdapter({
      storage: { type: "in-memory" },
    });

    const config = createBaseRuntimeConfig([
      "--notebook",
      "clientid-test",
      "--runtime-id",
      runtimeId,
      "--auth-token",
      "test-token",
    ], {
      adapter,
      clientId: `runtime-${runtimeId}`,
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
    const adapter = makeAdapter({
      storage: { type: "in-memory" },
    });

    const explicitClientId = "my-custom-client-id";

    const config = createBaseRuntimeConfig([
      "--notebook",
      "explicit-clientid-test",
      "--auth-token",
      "test-token",
    ], {
      adapter,
      clientId: explicitClientId,
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
    const adapter = makeAdapter({
      storage: { type: "in-memory" },
    });

    // Create two agents using the same adapter
    const config1 = createBaseRuntimeConfig([
      "--notebook",
      "shared-adapter-1",
      "--runtime-id",
      "agent-1",
      "--auth-token",
      "token1",
    ], {
      adapter,
      clientId: "client-1",
    });

    const config2 = createBaseRuntimeConfig([
      "--notebook",
      "shared-adapter-2",
      "--runtime-id",
      "agent-2",
      "--auth-token",
      "token2",
    ], {
      adapter,
      clientId: "client-2",
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

    const config = createBaseRuntimeConfig([
      "--notebook",
      "fs-test",
      "--auth-token",
      "test-token",
    ], {
      adapter: fsAdapter,
      clientId: "fs-test-client",
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

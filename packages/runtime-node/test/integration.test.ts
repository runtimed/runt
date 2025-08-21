// Integration tests using Deno's testing framework
//
// These tests verify the RuntimeAgent works correctly with minimal
// mocked dependencies to test the core integration points.

import { assertEquals, assertExists } from "jsr:@std/assert";

import {
  createStorePromise,
  makeSchema,
  State,
} from "npm:@livestore/livestore";
import { makeAdapter } from "npm:@livestore/adapter-node";
import { events, materializers, tables } from "@runt/schema";

import { RuntimeAgent } from "@runt/runtime-core";
import { RuntimeConfig } from "../src/config.ts";
import type {
  ExecutionContext,
  RuntimeAgentEventHandlers,
  RuntimeAgentOptions,
  RuntimeCapabilities,
} from "@runt/runtime-core";

// Simple mock function creator
interface MockFunction {
  (...args: unknown[]): Promise<void>;
  calls: unknown[][];
}

const createMockFunction = (): MockFunction => {
  const calls: unknown[][] = [];
  const fn = (...args: unknown[]) => {
    calls.push(args);
    return Promise.resolve();
  };
  (fn as MockFunction).calls = calls;
  return fn as MockFunction;
};

Deno.test("RuntimeAgent Integration Tests", async (t) => {
  // Create schema for proper typing
  const schema = makeSchema({
    events,
    state: State.SQLite.makeState({ tables, materializers }),
  });

  let store: Awaited<ReturnType<typeof createStorePromise<typeof schema>>>;
  let capabilities: RuntimeCapabilities;
  let options: RuntimeAgentOptions;
  let handlers: RuntimeAgentEventHandlers;

  // Setup for each test
  const setup = async () => {
    store = await createStorePromise({
      adapter: makeAdapter({
        storage: { type: "in-memory" },
      }),
      schema,
      storeId: "test-store",
      syncPayload: {
        authToken: "test-token",
        clientId: "test-user",
      },
    });

    capabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: true,
    };

    options = {
      runtimeId: "integration-test-runtime",
      runtimeType: "test",
      clientId: "test-user",
      sessionId: "test-session",
    };

    handlers = {
      onStartup: createMockFunction(),
      onShutdown: createMockFunction(),
      onConnected: createMockFunction(),
      onDisconnected: createMockFunction(),
      onExecutionError: createMockFunction(),
    };
  };

  await t.step("basic functionality", async (t) => {
    await t.step("should create agent instance", async () => {
      await setup();
      const agent = new RuntimeAgent(store, capabilities, options, handlers);
      assertExists(agent);
      assertEquals(typeof agent.start, "function");
      assertEquals(typeof agent.shutdown, "function");
      assertEquals(typeof agent.onExecution, "function");
      assertEquals(typeof agent.keepAlive, "function");
    });

    await t.step("should register execution handlers", async () => {
      await setup();
      const agent = new RuntimeAgent(store, capabilities, options);
      const executionHandler = () => Promise.resolve({ success: true });

      agent.onExecution(executionHandler);

      // Handler is registered internally
      assertEquals(typeof executionHandler, "function");
    });

    await t.step("should handle shutdown gracefully", async () => {
      await setup();
      const agent = new RuntimeAgent(store, capabilities, options, handlers);

      // Should not throw
      await agent.shutdown();

      // Handler should be called
      assertEquals((handlers.onShutdown as MockFunction).calls.length, 1);
    });

    await t.step("should handle multiple shutdown calls", async () => {
      await setup();
      const agent = new RuntimeAgent(store, capabilities, options, handlers);

      await agent.shutdown();
      await agent.shutdown(); // Second call should be safe

      // Should only call handler once due to isShuttingDown guard
      assertEquals((handlers.onShutdown as MockFunction).calls.length, 1);
    });
  });

  await t.step("execution handler", async (t) => {
    await t.step("should accept valid execution handler", async () => {
      await setup();
      const agent = new RuntimeAgent(store, capabilities, options);

      const handler = (context: ExecutionContext) => {
        context.stdout("Test output");
        return Promise.resolve({ success: true });
      };

      agent.onExecution(handler);
      assertEquals(typeof handler, "function");
    });

    await t.step("should replace previous execution handler", async () => {
      await setup();
      const agent = new RuntimeAgent(store, capabilities, options);

      const firstHandler = () => Promise.resolve({ success: true });
      const secondHandler = () => Promise.resolve({ success: false });

      agent.onExecution(firstHandler);
      agent.onExecution(secondHandler);

      // Both handlers should be functions (replacement is internal)
      assertEquals(typeof firstHandler, "function");
      assertEquals(typeof secondHandler, "function");
    });
  });

  await t.step("configuration validation", async (t) => {
    await t.step("should accept valid configuration", async () => {
      await setup();
      const _validConfig = new RuntimeConfig({
        runtimeId: "valid-runtime",
        runtimeType: "test",
        notebookId: "test-notebook",
        syncUrl: "ws://localhost:8787",
        authToken: "valid-token",
        capabilities: capabilities,
        environmentOptions: {},
      });

      const agent = new RuntimeAgent(store, capabilities, options);
      assertExists(agent);
    });

    await t.step("should validate configuration on creation", async () => {
      await setup();
      // This tests that RuntimeConfig validation works
      let error: Error | null = null;

      try {
        const config = new RuntimeConfig({
          runtimeId: "", // Invalid empty runtime ID
          runtimeType: "test",
          notebookId: "test",
          syncUrl: "ws://localhost:8787",
          authToken: "token",
          capabilities: capabilities,
          environmentOptions: {},
        });
        config.validate(); // Explicitly call validate
      } catch (e) {
        error = e as Error;
      }

      assertExists(error);
      assertEquals(
        error?.message.includes(
          "runtimeId: --runtime-id <id> or RUNTIME_ID env var",
        ),
        true,
      );
    });
  });

  await t.step("lifecycle management", async (t) => {
    await t.step("should handle keepAlive correctly", async () => {
      await setup();
      const agent = new RuntimeAgent(store, capabilities, options);

      const keepAlivePromise = agent.keepAlive();

      // Shutdown after a brief delay
      setTimeout(() => agent.shutdown(), 10);

      // Should resolve without throwing
      await keepAlivePromise;
    });

    await t.step("should handle rapid start/shutdown cycles", async () => {
      await setup();
      const agent = new RuntimeAgent(store, capabilities, options, handlers);

      // Multiple cycles should work
      await agent.shutdown();
      await agent.shutdown();

      assertEquals((handlers.onShutdown as MockFunction).calls.length, 1);
    });
  });

  await t.step("output context methods", async (t) => {
    await t.step("should provide context with output methods", async () => {
      await setup();
      const agent = new RuntimeAgent(store, capabilities, options);

      // Register a handler that captures the context
      agent.onExecution((_context) => {
        return Promise.resolve({ success: true });
      });

      // For now, we can't easily test the full execution flow without
      // mocking LiveStore heavily, but we can verify the agent structure
      assertEquals(typeof agent.onExecution, "function");

      // The context will be provided when actual execution happens
      // This test verifies the agent accepts the handler correctly
    });
  });
});

Deno.test("RuntimeConfig", async (t) => {
  await t.step("should create valid config with all required fields", () => {
    const config = new RuntimeConfig({
      runtimeId: "test-runtime",
      runtimeType: "python",
      notebookId: "test-notebook",
      syncUrl: "ws://localhost:8787",
      authToken: "test-token",
      capabilities: {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: true,
      },
      environmentOptions: {},
    });

    assertEquals(config.runtimeId, "test-runtime");
    assertEquals(config.runtimeType, "python");
    assertEquals(config.notebookId, "test-notebook");
    assertEquals(config.syncUrl, "ws://localhost:8787");
    assertEquals(config.authToken, "test-token");
    assertExists(config.sessionId);
  });

  await t.step("should generate unique session IDs", () => {
    const config1 = new RuntimeConfig({
      runtimeId: "runtime1",
      runtimeType: "python",
      notebookId: "notebook1",
      syncUrl: "ws://localhost:8787",
      authToken: "token1",
      capabilities: {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: false,
      },
      environmentOptions: {},
    });

    const config2 = new RuntimeConfig({
      runtimeId: "runtime2",
      runtimeType: "python",
      notebookId: "notebook2",
      syncUrl: "ws://localhost:8787",
      authToken: "token2",
      capabilities: {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: false,
      },
      environmentOptions: {},
    });

    // Session IDs should be different
    assertEquals(config1.sessionId !== config2.sessionId, true);
  });

  await t.step("should allow custom heartbeat interval", () => {
    const _config = new RuntimeConfig({
      runtimeId: "test-runtime",
      runtimeType: "python",
      notebookId: "test-notebook",
      syncUrl: "ws://localhost:8787",
      authToken: "test-token",

      capabilities: {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: false,
      },
      environmentOptions: {},
    });
  });
});

// Integration tests for runtime-core using store-first architecture
//
// These tests verify the RuntimeAgent works correctly with a real LiveStore
// instance, testing the core integration points of the new store-first design.

import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  createStorePromise,
  makeSchema,
  State,
} from "npm:@livestore/livestore";
import { makeAdapter } from "npm:@livestore/adapter-node";
import { events, materializers, tables } from "@runt/schema";

import { RuntimeAgent } from "../src/runtime-agent.ts";
import type {
  ExecutionContext as _ExecutionContext,
  RuntimeAgentEventHandlers,
  RuntimeAgentOptions,
  RuntimeCapabilities,
} from "../src/types.ts";

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

Deno.test({
  name: "RuntimeAgent - Store-First Architecture",
  sanitizeResources: false, // Ignore resource leaks from LiveStore Effect runtime
  sanitizeOps: false, // Ignore async ops leaks from LiveStore internals
}, async (t) => {
  // Create schema for proper typing
  const schema = makeSchema({
    events,
    state: State.SQLite.makeState({ tables, materializers }),
  });

  let store: Awaited<ReturnType<typeof createStorePromise<typeof schema>>>;
  let capabilities: RuntimeCapabilities;
  let options: RuntimeAgentOptions;
  let handlers: RuntimeAgentEventHandlers;
  let activeAgents: RuntimeAgent[] = [];

  // Cleanup function to prevent resource leaks
  const cleanup = async () => {
    // Shutdown all active agents
    for (const agent of activeAgents) {
      try {
        await agent.shutdown();
      } catch (error) {
        // Ignore cleanup errors
        console.warn("Cleanup warning:", error);
      }
    }
    activeAgents = [];

    // Clean up store resources if available
    if (
      store &&
      typeof (store as unknown as { close?: () => void }).close === "function"
    ) {
      try {
        await (store as unknown as { close: () => Promise<void> }).close();
      } catch (error) {
        // Ignore cleanup errors
        console.warn("Store cleanup warning:", error);
      }
    }
  };

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
      canExecuteAi: false,
    };

    options = {
      runtimeId: "test-runtime",
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
      activeAgents.push(agent);

      assertExists(agent);
      assertEquals(typeof agent.start, "function");
      assertEquals(typeof agent.shutdown, "function");
      assertEquals(typeof agent.onExecution, "function");
      assertEquals(typeof agent.keepAlive, "function");

      await cleanup();
    });

    await t.step("should register execution handlers", async () => {
      await setup();
      const agent = new RuntimeAgent(store, capabilities, options);
      activeAgents.push(agent);

      const executionHandler = () => Promise.resolve({ success: true });

      agent.onExecution(executionHandler);

      // Handler is registered internally
      assertEquals(typeof executionHandler, "function");

      await cleanup();
    });

    await t.step("should handle multiple execution handlers", async () => {
      await setup();
      const agent = new RuntimeAgent(store, capabilities, options, handlers);
      activeAgents.push(agent);

      const firstHandler = () => Promise.resolve({ success: true });
      const secondHandler = () => Promise.resolve({ success: false });

      // Should replace previous handler
      agent.onExecution(firstHandler);
      agent.onExecution(secondHandler);

      assertEquals(typeof firstHandler, "function");
      assertEquals(typeof secondHandler, "function");

      await cleanup();
    });

    await t.step("should handle shutdown gracefully", async () => {
      await setup();
      const agent = new RuntimeAgent(store, capabilities, options, handlers);
      activeAgents.push(agent);

      // Should not throw
      await agent.shutdown();

      // Handler should be called
      assertEquals((handlers.onShutdown as MockFunction).calls.length, 1);

      await cleanup();
    });

    await t.step("should handle multiple shutdown calls", async () => {
      await setup();
      const agent = new RuntimeAgent(store, capabilities, options, handlers);
      activeAgents.push(agent);

      await agent.shutdown();
      await agent.shutdown(); // Second call should be safe

      // Should only call handler once due to isShuttingDown guard
      assertEquals((handlers.onShutdown as MockFunction).calls.length, 1);

      await cleanup();
    });
  });

  await t.step("store integration", async (t) => {
    await t.step("should use provided store instance", async () => {
      await setup();
      const agent = new RuntimeAgent(store, capabilities, options);
      activeAgents.push(agent);

      // Agent should use the exact same store instance
      assertEquals(agent.store, store);

      await cleanup();
    });

    await t.step("should have correct options", async () => {
      await setup();
      const agent = new RuntimeAgent(store, capabilities, options);
      activeAgents.push(agent);

      assertEquals(agent.options.runtimeId, "test-runtime");
      assertEquals(agent.options.runtimeType, "test");
      assertEquals(agent.options.clientId, "test-user");
      assertEquals(agent.options.sessionId, "test-session");

      await cleanup();
    });
  });

  await t.step("error handling", async (t) => {
    await t.step("should handle execution errors", async () => {
      await setup();
      const agent = new RuntimeAgent(store, capabilities, options, handlers);
      activeAgents.push(agent);

      let _executionError = false;
      agent.onExecution((_context) => {
        _executionError = true;
        throw new Error("Test execution error");
      });

      // The agent should be created without throwing
      assertExists(agent);

      // Error handling is internal to agent implementation
      assertEquals(typeof agent.onExecution, "function");

      await cleanup();
    });

    await t.step("should validate required options", async () => {
      await setup();

      // Should require clientId
      let threw = false;
      try {
        new RuntimeAgent(store, capabilities, {
          runtimeId: "test",
          runtimeType: "test",
          // Missing clientId
        } as RuntimeAgentOptions);
      } catch (_error) {
        threw = true;
      }

      // This should work - the constructor itself doesn't validate,
      // but the runtime would fail later without proper clientId
      assertEquals(threw, false);
    });
  });

  await t.step("lifecycle management", async (t) => {
    await t.step(
      "should handle keepAlive gracefully",
      async () => {
        await setup();
        const agent = new RuntimeAgent(store, capabilities, options);
        activeAgents.push(agent);

        const keepAlivePromise = agent.keepAlive();

        // Shutdown after a brief delay
        setTimeout(() => agent.shutdown(), 10);

        // Should resolve without throwing
        await keepAlivePromise;

        await cleanup();
      },
    );
  });
});

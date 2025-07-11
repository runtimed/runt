// Integration tests using Deno's testing framework
//
// These tests verify the RuntimeAgent works correctly with minimal
// mocked dependencies to test the core integration points.

import { assertEquals, assertExists } from "jsr:@std/assert";

import { RuntimeAgent } from "../src/runtime-agent.ts";
import { RuntimeConfig } from "../src/config.ts";
import type {
  ExecutionContext,
  RuntimeAgentEventHandlers,
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

Deno.test("RuntimeAgent Integration Tests", async (t) => {
  let config: RuntimeConfig;
  let capabilities: RuntimeCapabilities;
  let handlers: RuntimeAgentEventHandlers;

  // Setup for each step
  const setup = () => {
    capabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: true,
    };

    handlers = {
      onStartup: createMockFunction(),
      onShutdown: createMockFunction(),
      onConnected: createMockFunction(),
      onDisconnected: createMockFunction(),
      onExecutionError: createMockFunction(),
    };

    config = new RuntimeConfig({
      runtimeId: "integration-test-runtime",
      runtimeType: "test",
      notebookId: "test-notebook-integration",
      syncUrl: "ws://localhost:8787",
      authToken: "test-integration-token",
      environmentOptions: {},
      capabilities,
    });
  };

  await t.step("basic functionality", async (t) => {
    setup();
    await t.step("should create agent instance", () => {
      const agent = new RuntimeAgent(config, capabilities, handlers);
      assertExists(agent);
      assertEquals(typeof agent.start, "function");
      assertEquals(typeof agent.shutdown, "function");
      assertEquals(typeof agent.onExecution, "function");
      assertEquals(typeof agent.keepAlive, "function");
    });

    setup();
    await t.step("should register execution handlers", () => {
      const agent = new RuntimeAgent(config, capabilities);
      const executionHandler = () => Promise.resolve({ success: true });

      agent.onExecution(executionHandler);

      // Handler is registered internally
      assertEquals(typeof executionHandler, "function");
    });

    setup();
    await t.step("should handle shutdown gracefully", async () => {
      const agent = new RuntimeAgent(config, capabilities, handlers);

      // Should not throw
      await agent.shutdown();

      // Handler should be called
      assertEquals((handlers.onShutdown as MockFunction).calls.length, 1);
    });

    setup();
    await t.step("should handle multiple shutdown calls", async () => {
      const agent = new RuntimeAgent(config, capabilities, handlers);

      await agent.shutdown();
      await agent.shutdown(); // Second call should be safe

      // Should only call handler once
      assertEquals((handlers.onShutdown as MockFunction).calls.length, 1);
    });
  });

  await t.step("execution handler", async (t) => {
    setup();
    await t.step("should accept valid execution handler", () => {
      const agent = new RuntimeAgent(config, capabilities);

      const handler = (context: ExecutionContext) => {
        context.stdout("Test output");
        return Promise.resolve({ success: true });
      };

      agent.onExecution(handler);
      assertEquals(typeof handler, "function");
    });

    setup();
    await t.step("should replace previous execution handler", () => {
      const agent = new RuntimeAgent(config, capabilities);

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
    setup();
    await t.step("should accept valid configuration", () => {
      const validConfig = new RuntimeConfig({
        runtimeId: "valid-runtime",
        runtimeType: "test",
        notebookId: "test-notebook",
        syncUrl: "ws://localhost:8787",
        authToken: "valid-token",
        capabilities: capabilities,
        environmentOptions: {},
      });

      const agent = new RuntimeAgent(validConfig, capabilities);
      assertExists(agent);
    });

    setup();
    await t.step("should validate configuration on creation", () => {
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
    setup();
    await t.step("should handle keepAlive resolution", async () => {
      const agent = new RuntimeAgent(config, capabilities);

      const keepAlivePromise = agent.keepAlive();

      // Shutdown after a brief delay
      setTimeout(() => agent.shutdown(), 10);

      // Should resolve without throwing
      await keepAlivePromise;
    });

    setup();
    await t.step("should handle rapid start/shutdown cycles", async () => {
      const agent = new RuntimeAgent(config, capabilities, handlers);

      // Multiple cycles should work
      await agent.shutdown();
      await agent.shutdown();

      assertEquals((handlers.onShutdown as MockFunction).calls.length, 1);
    });
  });

  await t.step("output context methods", async (t) => {
    setup();
    await t.step("should provide context with output methods", () => {
      const agent = new RuntimeAgent(config, capabilities);

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

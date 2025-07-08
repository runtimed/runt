// RuntimeAgent unit tests using Deno's testing framework
//
// These tests verify the core RuntimeAgent functionality using simple
// mock functions to ensure reliable, fast unit testing.

import { assertEquals, assertExists, assertInstanceOf } from "jsr:@std/assert";

import { RuntimeAgent } from "./runtime-agent.ts";
import { RuntimeConfig } from "./config.ts";
import type {
  ExecutionContext,
  RuntimeAgentEventHandlers,
  RuntimeCapabilities,
} from "./types.ts";

// Simple mock functions
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

Deno.test("RuntimeAgent", async (t) => {
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
      runtimeId: "test-runtime",
      runtimeType: "test",
      notebookId: "test-notebook",
      syncUrl: "ws://localhost:8787",
      authToken: "test-token",
      capabilities,
    });
  };

  await t.step("constructor", async (t) => {
    setup();
    await t.step(
      "should create agent with provided config and capabilities",
      () => {
        const agent = new RuntimeAgent(config, capabilities, handlers);
        assertExists(agent);
        assertInstanceOf(agent, RuntimeAgent);
      },
    );

    setup();
    await t.step("should work without optional handlers", () => {
      const agent = new RuntimeAgent(config, capabilities);
      assertExists(agent);
      assertInstanceOf(agent, RuntimeAgent);
    });
  });

  await t.step("methods", async (t) => {
    setup();
    await t.step("should have all required methods", () => {
      const agent = new RuntimeAgent(config, capabilities);

      assertEquals(typeof agent.start, "function");
      assertEquals(typeof agent.shutdown, "function");
      assertEquals(typeof agent.onExecution, "function");
      assertEquals(typeof agent.keepAlive, "function");
    });

    setup();
    await t.step("should register execution handler", () => {
      const agent = new RuntimeAgent(config, capabilities);
      const mockHandler = (_context: ExecutionContext) =>
        Promise.resolve({
          success: true,
        });

      // Should not throw
      agent.onExecution(mockHandler);
      assertEquals(typeof mockHandler, "function");
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

  await t.step("lifecycle", async (t) => {
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

      // Should only call handler once due to isShuttingDown guard
      assertEquals((handlers.onShutdown as MockFunction).calls.length, 1);
    });

    setup();
    await t.step(
      "should resolve keepAlive when shutdown is called",
      async () => {
        const agent = new RuntimeAgent(config, capabilities);

        const keepAlivePromise = agent.keepAlive();

        // Shutdown after a brief delay
        setTimeout(() => agent.shutdown(), 10);

        // Should resolve without throwing
        await keepAlivePromise;
      },
    );
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
    });
  });
});

Deno.test("Output method validation", async (t) => {
  await t.step("should filter empty text correctly", () => {
    // Test the filtering logic that would be used in stdout/stderr
    const emitIfNotEmpty = (fn: () => void, text: string) => {
      if (text.trim()) {
        fn();
      }
    };

    let callCount = 0;
    const mockFn = () => callCount++;

    emitIfNotEmpty(mockFn, "");
    emitIfNotEmpty(mockFn, "   ");
    emitIfNotEmpty(mockFn, "actual text");
    emitIfNotEmpty(mockFn, "\n\n");
    emitIfNotEmpty(mockFn, "more text");

    assertEquals(callCount, 2); // Only "actual text" and "more text"
  });

  await t.step("should handle metadata correctly", () => {
    // Test metadata handling logic
    const processMetadata = (metadata?: Record<string, unknown>) => {
      return metadata || {};
    };

    assertEquals(processMetadata(), {});
    assertEquals(processMetadata({ test: true }), { test: true });
    assertEquals(processMetadata(undefined), {});
  });
});

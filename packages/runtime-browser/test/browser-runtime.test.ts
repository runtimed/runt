import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import {
  createStorePromise,
  makeSchema,
  State,
} from "npm:@livestore/livestore";
import { makeAdapter } from "npm:@livestore/adapter-node"; // Use node adapter for Deno testing
import { events, materializers, tables } from "@runt/schema";
import { createBrowserRuntimeAgent } from "../mod.ts";
import { RuntimeAgent } from "@runt/runtime-core";
import type { RuntimeCapabilities } from "@runt/runtime-core";

// Simple mock for browser environment
Object.defineProperty(globalThis, "window", {
  value: {
    addEventListener: () => {},
    crypto: globalThis.crypto,
  },
  configurable: true,
});

Object.defineProperty(globalThis, "document", {
  value: {
    addEventListener: () => {},
    visibilityState: "visible",
  },
  configurable: true,
});

Deno.test({
  name: "Browser Runtime Agent - Core Functionality",
  sanitizeResources: false, // Ignore resource leaks from LiveStore Effect runtime
  sanitizeOps: false, // Ignore async ops leaks from LiveStore internals
}, async (t) => {
  const schema = makeSchema({
    events,
    state: State.SQLite.makeState({ tables, materializers }),
  });

  let store: Awaited<ReturnType<typeof createStorePromise<typeof schema>>>;
  let capabilities: RuntimeCapabilities;
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
    if (store && typeof (store as any).close === "function") {
      try {
        await (store as any).close();
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
  };

  await t.step("should create agent with required parameters", async () => {
    await setup();

    const agent = createBrowserRuntimeAgent(store, capabilities, {
      clientId: "test-user",
      runtimeId: "test-runtime",
      runtimeType: "echo",
    });
    activeAgents.push(agent);

    assertExists(agent);
    assertEquals(agent.options.clientId, "test-user");
    assertEquals(agent.options.runtimeId, "test-runtime");
    assertEquals(agent.options.runtimeType, "echo");
    assertEquals(agent.store, store);

    await cleanup();
  });

  await t.step("should generate defaults for optional parameters", async () => {
    await setup();

    const agent = createBrowserRuntimeAgent(store, capabilities, {
      clientId: "test-user",
    });
    activeAgents.push(agent);

    assertExists(agent);
    assertEquals(agent.options.clientId, "test-user");
    assertEquals(agent.options.runtimeType, "echo"); // default
    assertExists(agent.options.runtimeId); // generated
    assertExists(agent.options.sessionId); // generated

    await cleanup();
  });

  await t.step("should require clientId", async () => {
    await setup();

    assertThrows(
      () => {
        createBrowserRuntimeAgent(store, capabilities);
      },
      Error,
      "clientId is required for browser runtime agents",
    );

    await cleanup();
  });

  await t.step("should accept different runtime types", async () => {
    await setup();

    const agent = createBrowserRuntimeAgent(store, capabilities, {
      clientId: "test-user",
      runtimeType: "python",
    });
    activeAgents.push(agent);

    assertEquals(agent.options.runtimeType, "python");

    await cleanup();
  });

  await t.step("should use provided store instance", async () => {
    await setup();

    const agent = createBrowserRuntimeAgent(store, capabilities, {
      clientId: "test-user",
    });
    activeAgents.push(agent);

    // The agent should be using the exact same store instance
    assertEquals(agent.store, store);

    await cleanup();
  });

  await t.step("should shutdown gracefully", async () => {
    await setup();

    const agent = createBrowserRuntimeAgent(store, capabilities, {
      clientId: "test-user",
    });
    activeAgents.push(agent);

    // Should not throw
    await agent.shutdown();

    await cleanup();
  });

  await t.step("should set up execution handler", async () => {
    await setup();

    const agent = createBrowserRuntimeAgent(store, capabilities, {
      clientId: "test-user",
    });
    activeAgents.push(agent);

    let _handlerCalled = false;

    // Should be able to set execution handler
    agent.onExecution(async (context) => {
      _handlerCalled = true;
      await context.result({
        "text/plain": `Echo: ${context.cell.source}`,
      });
      return { success: true };
    });

    // Handler setup should work without errors
    assertExists(agent);

    await cleanup();
  });
});

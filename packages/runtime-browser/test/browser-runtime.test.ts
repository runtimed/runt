import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import {
  createStorePromise,
  makeSchema,
  State,
} from "npm:@livestore/livestore";
import { makeAdapter } from "npm:@livestore/adapter-node"; // Use node adapter for Deno testing
import { events, materializers, tables } from "@runt/schema";
import { createBrowserRuntimeAgent } from "../mod.ts";
import type { RuntimeCapabilities } from "@runt/runtime-core";

// Simple mock for browser environment
(globalThis as any).window = {
  addEventListener: () => {},
  crypto: globalThis.crypto,
};
(globalThis as any).document = {
  addEventListener: () => {},
  visibilityState: "visible",
};

Deno.test("Browser Runtime Agent - Core Functionality", async (t) => {
  let store: Awaited<ReturnType<typeof createStorePromise>>;
  let capabilities: RuntimeCapabilities;

  // Setup for each test
  const setup = async () => {
    const schema = makeSchema({
      events,
      state: State.SQLite.makeState({ tables, materializers }),
    });

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

    assertExists(agent);
    assertEquals(agent.options.clientId, "test-user");
    assertEquals(agent.options.runtimeId, "test-runtime");
    assertEquals(agent.options.runtimeType, "echo");
    assertEquals(agent.store, store);
  });

  await t.step("should generate defaults for optional parameters", async () => {
    await setup();

    const agent = createBrowserRuntimeAgent(store, capabilities, {
      clientId: "test-user",
    });

    assertExists(agent);
    assertEquals(agent.options.clientId, "test-user");
    assertEquals(agent.options.runtimeType, "echo"); // default
    assertExists(agent.options.runtimeId); // generated
    assertExists(agent.options.sessionId); // generated
  });

  await t.step("should require clientId", async () => {
    await setup();

    assertThrows(
      () => {
        createBrowserRuntimeAgent(store, capabilities);
      },
      Error,
      "clientId is required",
    );
  });

  await t.step("should accept different runtime types", async () => {
    await setup();

    const agent = createBrowserRuntimeAgent(store, capabilities, {
      clientId: "test-user",
      runtimeType: "python",
    });

    assertEquals(agent.options.runtimeType, "python");
  });

  await t.step("should use provided store instance", async () => {
    await setup();

    const agent = createBrowserRuntimeAgent(store, capabilities, {
      clientId: "test-user",
    });

    // The agent should be using the exact same store instance
    assertEquals(agent.store, store);
  });

  await t.step("should shutdown gracefully", async () => {
    await setup();

    const agent = createBrowserRuntimeAgent(store, capabilities, {
      clientId: "test-user",
    });

    // Should not throw
    await agent.shutdown();
  });

  await t.step("should set up execution handler", async () => {
    await setup();

    const agent = createBrowserRuntimeAgent(store, capabilities, {
      clientId: "test-user",
    });

    let handlerCalled = false;

    // Should be able to set execution handler
    agent.onExecution(async (context) => {
      handlerCalled = true;
      await context.result({
        "text/plain": `Echo: ${context.cell.source}`,
      });
      return { success: true };
    });

    // Handler setup should work without errors
    assertExists(agent);
  });
});

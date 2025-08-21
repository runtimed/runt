// Enhanced Output Example - Store-First Architecture Demo
//
// This example demonstrates how to create and use a RuntimeAgent with
// the store-first architecture, showing proper LiveStore setup and
// runtime agent lifecycle management.

import {
  createStorePromise,
  makeSchema,
  State,
} from "npm:@livestore/livestore";
import { makeAdapter } from "npm:@livestore/adapter-node";
import { events, materializers, tables } from "@runt/schema";

import { RuntimeAgent } from "../src/runtime-agent.ts";
import type {
  ExecutionContext,
  RuntimeAgentEventHandlers,
  RuntimeAgentOptions,
  RuntimeCapabilities,
} from "../src/types.ts";

// Create schema for proper typing
const schema = makeSchema({
  events,
  state: State.SQLite.makeState({ tables, materializers }),
});

/**
 * Example runtime that demonstrates store-first architecture
 */
export class ExamplePythonRuntime {
  private agent: RuntimeAgent | null = null;
  private store:
    | Awaited<ReturnType<typeof createStorePromise<typeof schema>>>
    | null = null;

  constructor(
    private options: {
      runtimeId: string;
      runtimeType: string;
      clientId: string;
      sessionId?: string;
    },
  ) {}

  async initialize(): Promise<void> {
    // Create LiveStore instance
    this.store = await createStorePromise({
      adapter: makeAdapter({
        storage: { type: "in-memory" },
      }),
      schema,
      storeId: "example-store",
      syncPayload: {
        authToken: "example-token",
        clientId: this.options.clientId,
      },
    });

    // Define capabilities
    const capabilities: RuntimeCapabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    };

    // Define runtime options
    const runtimeOptions: RuntimeAgentOptions = {
      runtimeId: this.options.runtimeId,
      runtimeType: this.options.runtimeType,
      clientId: this.options.clientId,
      sessionId: this.options.sessionId,
    };

    // Define event handlers
    const handlers: RuntimeAgentEventHandlers = {
      onStartup: async () => {
        console.log(`🚀 ${this.options.runtimeType} runtime started`);
      },
      onShutdown: async () => {
        console.log(`🛑 ${this.options.runtimeType} runtime stopped`);
      },
    };

    // Create runtime agent with store-first pattern
    this.agent = new RuntimeAgent(
      this.store,
      capabilities,
      runtimeOptions,
      handlers,
    );

    // Register execution handler
    this.agent.onExecution(this.handleExecution.bind(this));
  }

  private async handleExecution(
    context: ExecutionContext,
  ): Promise<{ success: boolean }> {
    // Demonstrate enhanced output capabilities
    context.stdout("🐍 Python-like execution starting...\n");

    // Simulate some processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    context.stdout("📊 Processing data...\n");
    context.display({
      "text/plain": "Sample output from Python-like runtime",
      "application/json": {
        result: "success",
        timestamp: new Date().toISOString(),
      },
    });

    context.stdout("✅ Execution complete!\n");

    return { success: true };
  }

  async start(): Promise<void> {
    if (!this.agent) {
      throw new Error("Runtime not initialized. Call initialize() first.");
    }
    await this.agent.start();
  }

  async shutdown(): Promise<void> {
    if (this.agent) {
      await this.agent.shutdown();
    }
  }

  getAgent(): RuntimeAgent | null {
    return this.agent;
  }
}

/**
 * Comparison example showing different runtime configurations
 */
export class ComparisonExample {
  private runtimes: ExamplePythonRuntime[] = [];

  async createRuntimes(): Promise<void> {
    // Create multiple runtime instances for comparison
    const configs = [
      { runtimeId: "python-1", runtimeType: "python", clientId: "user-1" },
      {
        runtimeId: "enhanced-python-1",
        runtimeType: "enhanced-python",
        clientId: "user-1",
      },
    ];

    for (const config of configs) {
      const runtime = new ExamplePythonRuntime(config);
      await runtime.initialize();
      this.runtimes.push(runtime);
    }
  }

  async startAll(): Promise<void> {
    await Promise.all(this.runtimes.map((runtime) => runtime.start()));
  }

  async shutdownAll(): Promise<void> {
    await Promise.all(this.runtimes.map((runtime) => runtime.shutdown()));
  }

  getRuntimes(): ExamplePythonRuntime[] {
    return this.runtimes;
  }
}

/**
 * Main example runner function
 */
export async function runExample(): Promise<void> {
  console.log("🔧 Runtime Core Enhanced Output Example");
  console.log("=====================================\n");

  // Example 1: Single runtime
  console.log("1️⃣ Creating single runtime instance...");
  const singleRuntime = new ExamplePythonRuntime({
    runtimeId: "example-runtime",
    runtimeType: "enhanced-python",
    clientId: "example-user",
  });

  try {
    await singleRuntime.initialize();
    await singleRuntime.start();

    console.log("✅ Single runtime example completed\n");

    await singleRuntime.shutdown();
  } catch (error) {
    console.error("❌ Single runtime example failed:", error);
  }

  // Example 2: Multiple runtimes comparison
  console.log("2️⃣ Creating multiple runtime instances...");
  const comparison = new ComparisonExample();

  try {
    await comparison.createRuntimes();
    await comparison.startAll();

    console.log(
      `✅ Created ${comparison.getRuntimes().length} runtime instances`,
    );
    console.log("✅ Multiple runtime example completed\n");

    await comparison.shutdownAll();
  } catch (error) {
    console.error("❌ Multiple runtime example failed:", error);
  }

  console.log("🎉 All examples completed successfully!");
}

// Run the example if this file is executed directly
if (import.meta.main) {
  await runExample();
}

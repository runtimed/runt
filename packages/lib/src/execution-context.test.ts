// ExecutionContext output methods tests

import { assertEquals } from "jsr:@std/assert";
import { createStorePromise, queryDb } from "npm:@livestore/livestore";
import { makeAdapter } from "npm:@livestore/adapter-node";

import { RuntimeAgent } from "./runtime-agent.ts";
import { RuntimeConfig } from "./config.ts";
import type { ExecutionContext, KernelCapabilities } from "./types.ts";
import { schema } from "@runt/schema";

// Helper to create a real in-memory store for testing
async function createTestStore() {
  const adapter = makeAdapter({
    databasePath: ":memory:",
  });

  const store = await createStorePromise({
    schema,
    adapter,
    storeId: `test-${crypto.randomUUID()}`,
  });

  return store;
}

// Helper to create test execution context
async function createTestContext() {
  const capabilities: KernelCapabilities = {
    canExecuteCode: true,
    canExecuteSql: false,
    canExecuteAi: false,
  };

  const config = new RuntimeConfig({
    kernelId: "test-kernel",
    kernelType: "test",
    notebookId: "test-notebook",
    syncUrl: "ws://localhost:8787",
    authToken: "test-token",
    capabilities,
  });

  const store = await createTestStore();

  // Initialize a test notebook
  await store.commit({
    type: "notebookInitialized",
    id: config.notebookId,
    title: "Test Notebook",
    ownerId: "test-user",
  });

  // Create a test cell
  const cellId = "test-cell-123";
  await store.commit({
    type: "cellCreated",
    id: cellId,
    cellType: "code",
    position: 0,
    createdBy: "test-user",
  });

  await store.commit({
    type: "cellSourceChanged",
    id: cellId,
    source: "print('test')",
    modifiedBy: "test-user",
  });

  // Create execution queue entry
  const queueId = "test-queue-456";
  await store.commit({
    type: "executionRequested",
    queueId,
    cellId,
    executionCount: 1,
    requestedBy: "test-user",
    priority: 1,
  });

  // Start kernel session
  await store.commit({
    type: "kernelSessionStarted",
    sessionId: config.sessionId,
    kernelId: config.kernelId,
    kernelType: config.kernelType,
    capabilities,
  });

  // Assign execution to kernel
  await store.commit({
    type: "executionAssigned",
    queueId,
    kernelSessionId: config.sessionId,
  });

  // Get the cell and queue entry data
  const cells = store.query(
    queryDb(schema.state.tables.cells.select().where({ id: cellId })),
  );
  const queueEntries = store.query(
    queryDb(schema.state.tables.executionQueue.select().where({ id: queueId })),
  );

  const cell = cells[0];
  const queueEntry = queueEntries[0];

  // Create a real agent
  const agent = new RuntimeAgent(config, capabilities);

  // Use reflection to set the store (normally done internally)
  (agent as any).store = store;

  // Create execution context using the agent's internal method
  const controller = new AbortController();
  let outputPosition = 0;

  const context: ExecutionContext = {
    cell: cell as any,
    queueEntry: queueEntry as any,
    store: store as any,
    sessionId: config.sessionId,
    kernelId: config.kernelId,
    abortSignal: controller.signal,
    checkCancellation: () => {
      if (controller.signal.aborted) {
        throw new Error("Execution cancelled");
      }
    },

    stdout: (text: string) => {
      if (text) {
        store.commit({
          type: "terminalOutputAdded",
          id: crypto.randomUUID(),
          cellId: cell.id,
          position: outputPosition++,
          content: {
            type: "inline",
            data: text,
          },
          streamName: "stdout",
        });
      }
    },

    stderr: (text: string) => {
      if (text) {
        store.commit({
          type: "terminalOutputAdded",
          id: crypto.randomUUID(),
          cellId: cell.id,
          position: outputPosition++,
          content: {
            type: "inline",
            data: text,
          },
          streamName: "stderr",
        });
      }
    },

    display: (data, metadata, displayId) => {
      const representations: Record<string, any> = {};
      for (const [mimeType, content] of Object.entries(data)) {
        representations[mimeType] = {
          type: "inline",
          data: content,
          metadata: metadata?.[mimeType],
        };
      }

      store.commit({
        type: "multimediaDisplayOutputAdded",
        id: crypto.randomUUID(),
        cellId: cell.id,
        position: outputPosition++,
        representations,
        displayId,
      });
    },

    updateDisplay: (displayId, data, metadata) => {
      // For simplicity, just call display again
      context.display(data, metadata, displayId);
    },

    result: (data, metadata) => {
      const representations: Record<string, any> = {};
      for (const [mimeType, content] of Object.entries(data)) {
        representations[mimeType] = {
          type: "inline",
          data: content,
          metadata: metadata?.[mimeType],
        };
      }

      store.commit({
        type: "multimediaResultOutputAdded",
        id: crypto.randomUUID(),
        cellId: cell.id,
        position: outputPosition++,
        representations,
        executionCount: queueEntry.executionCount,
      });
    },

    error: (ename, evalue, traceback) => {
      store.commit({
        type: "errorOutputAdded",
        id: crypto.randomUUID(),
        cellId: cell.id,
        position: outputPosition++,
        content: {
          type: "inline",
          data: { ename, evalue, traceback },
        },
      });
    },

    clear: (wait = false) => {
      store.commit({
        type: "cellOutputsCleared",
        cellId: cell.id,
        wait,
        clearedBy: `kernel-${config.kernelId}`,
      });
      if (!wait) {
        outputPosition = 0;
      }
    },

    appendTerminal: (outputId, text) => {
      if (text) {
        store.commit({
          type: "terminalOutputAppended",
          outputId,
          content: {
            type: "inline",
            data: text,
          },
        });
      }
    },

    markdown: (content, metadata) => {
      store.commit({
        type: "markdownOutputAdded",
        id: crypto.randomUUID(),
        cellId: cell.id,
        position: outputPosition++,
        content: {
          type: "inline",
          data: content,
          metadata,
        },
      });
    },

    appendMarkdown: (outputId, content) => {
      store.commit({
        type: "markdownOutputAppended",
        outputId,
        content: {
          type: "inline",
          data: content,
        },
      });
    },
  };

  return { context, store, cellId };
}

Deno.test("ExecutionContext - stdout output", async () => {
  const { context, store, cellId } = await createTestContext();

  context.stdout("Hello, world!");

  const outputs = store.query(
    queryDb(schema.state.tables.outputs.select().where({ cellId })),
  );

  assertEquals(outputs.length, 1);
  assertEquals(outputs[0].outputType, "stream");
  assertEquals(outputs[0].data.name, "stdout");
  assertEquals(outputs[0].data.text, "Hello, world!");
});

Deno.test("ExecutionContext - stderr output", async () => {
  const { context, store, cellId } = await createTestContext();

  context.stderr("Error message");

  const outputs = store.query(
    queryDb(schema.state.tables.outputs.select().where({ cellId })),
  );

  assertEquals(outputs.length, 1);
  assertEquals(outputs[0].outputType, "stream");
  assertEquals(outputs[0].data.name, "stderr");
  assertEquals(outputs[0].data.text, "Error message");
});

Deno.test("ExecutionContext - display output", async () => {
  const { context, store, cellId } = await createTestContext();

  context.display({
    "text/html": "<p>Hello</p>",
    "text/plain": "Hello",
  });

  const outputs = store.query(
    queryDb(schema.state.tables.outputs.select().where({ cellId })),
  );

  assertEquals(outputs.length, 1);
  assertEquals(outputs[0].outputType, "display_data");
  assertEquals(outputs[0].data["text/html"].data, "<p>Hello</p>");
  assertEquals(outputs[0].data["text/plain"].data, "Hello");
});

Deno.test("ExecutionContext - result output", async () => {
  const { context, store, cellId } = await createTestContext();

  context.result({
    "application/json": { result: 42 },
    "text/plain": "42",
  });

  const outputs = store.query(
    queryDb(schema.state.tables.outputs.select().where({ cellId })),
  );

  assertEquals(outputs.length, 1);
  assertEquals(outputs[0].outputType, "execute_result");
  assertEquals(outputs[0].data["application/json"].data.result, 42);
  assertEquals(outputs[0].data["text/plain"].data, "42");
});

Deno.test("ExecutionContext - error output", async () => {
  const { context, store, cellId } = await createTestContext();

  context.error("ValueError", "Invalid input", [
    "  File line 1",
    "    x = int('abc')",
  ]);

  const outputs = store.query(
    queryDb(schema.state.tables.outputs.select().where({ cellId })),
  );

  assertEquals(outputs.length, 1);
  assertEquals(outputs[0].outputType, "error");
  assertEquals(outputs[0].data.ename, "ValueError");
  assertEquals(outputs[0].data.evalue, "Invalid input");
  assertEquals(outputs[0].data.traceback.length, 2);
});

Deno.test("ExecutionContext - clear outputs", async () => {
  const { context, store, cellId } = await createTestContext();

  // Add some outputs
  context.stdout("Output 1");
  context.stdout("Output 2");

  let outputs = store.query(
    queryDb(schema.state.tables.outputs.select().where({ cellId })),
  );
  assertEquals(outputs.length, 2);

  // Clear outputs
  context.clear(false);

  outputs = store.query(
    queryDb(schema.state.tables.outputs.select().where({ cellId })),
  );
  assertEquals(outputs.length, 0);
});

Deno.test("ExecutionContext - markdown output", async () => {
  const { context, store, cellId } = await createTestContext();

  context.markdown("# Hello World\n\nThis is markdown content.");

  const outputs = store.query(
    queryDb(schema.state.tables.outputs.select().where({ cellId })),
  );

  assertEquals(outputs.length, 1);
  assertEquals(outputs[0].outputType, "display_data");
  assertEquals(
    outputs[0].data["text/markdown"].data,
    "# Hello World\n\nThis is markdown content.",
  );
});

Deno.test("ExecutionContext - terminal append", async () => {
  const { context, store, cellId } = await createTestContext();

  // Add initial output
  context.stdout("Hello");

  const outputs = store.query(
    queryDb(schema.state.tables.outputs.select().where({ cellId })),
  );
  const outputId = outputs[0].id;

  // Append to it
  context.appendTerminal(outputId, " World!");

  const updatedOutputs = store.query(
    queryDb(schema.state.tables.outputs.select().where({ cellId })),
  );

  assertEquals(updatedOutputs.length, 1);
  assertEquals(updatedOutputs[0].data.text, "Hello World!");
});

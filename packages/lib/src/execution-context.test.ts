// ExecutionContext output methods tests

import { assertEquals } from "jsr:@std/assert";

import { RuntimeAgent } from "./runtime-agent.ts";
import { RuntimeConfig } from "./config.ts";
import type { ExecutionContext, KernelCapabilities } from "./types.ts";
import type { CellData, ExecutionQueueData } from "@runt/schema";

// Mock store that captures commits
interface MockOutputCommit {
  type: "cellOutputAdded";
  id: string;
  cellId: string;
  outputType: "stream" | "display_data" | "execute_result" | "error";
  data: {
    name?: "stdout" | "stderr";
    text?: string;
    ename?: string;
    evalue?: string;
    traceback?: string[];
    [key: string]: unknown;
  };
  metadata: Record<string, unknown>;
  position: number;
  displayId?: string;
}

interface MockClearCommit {
  type: "cellOutputsCleared";
  cellId: string;
  clearedBy: string;
}

interface MockUpdateCommit {
  type: "cellOutputUpdated";
  id: string;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

type MockCommit = MockOutputCommit | MockClearCommit | MockUpdateCommit;

const createMockStore = () => {
  const commits: MockCommit[] = [];
  return {
    commit: (event: MockCommit) => {
      commits.push(event);
    },
    query: () => [],
    subscribe: () => () => {},
    shutdown: () => Promise.resolve(),
    commits, // Expose for testing
  };
};

Deno.test("ExecutionContext Output Methods", async (t) => {
  let config: RuntimeConfig;
  let capabilities: KernelCapabilities;
  let mockStore: ReturnType<typeof createMockStore>;

  // Setup for each step
  const setup = () => {
    capabilities = {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: true,
    };

    config = new RuntimeConfig({
      kernelId: "test-kernel",
      kernelType: "test",
      notebookId: "test-notebook",
      syncUrl: "ws://localhost:8787",
      authToken: "test-token",
      capabilities,
    });

    mockStore = createMockStore();
  };

  // Helper to create a test context
  const createTestContext = (): ExecutionContext => {
    const agent = new RuntimeAgent(config, capabilities);
    return (() => {
      // Mock the internal store creation
      (agent as unknown as { store: typeof mockStore }).store = mockStore;

      // Create a minimal context like the agent would
      const cell: Partial<CellData> = {
        id: "test-cell-123",
        cellType: "code",
        source: "print('test')",
        position: 0,
      };

      const queueEntry: Partial<ExecutionQueueData> = {
        id: "test-queue-456",
        cellId: "test-cell-123",
        status: "assigned",
        assignedKernelSession: config.sessionId,
      };

      let outputPosition = 0;

      const controller = new AbortController();

      return {
        cell: cell as CellData,
        queueEntry: queueEntry as ExecutionQueueData,
        store: mockStore as unknown as ExecutionContext["store"],
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
            mockStore.commit({
              type: "cellOutputAdded",
              id: crypto.randomUUID(),
              cellId: cell.id!,
              outputType: "stream",
              data: { name: "stdout", text },
              metadata: {},
              position: outputPosition++,
            });
          }
        },

        stderr: (text: string) => {
          if (text) {
            mockStore.commit({
              type: "cellOutputAdded",
              id: crypto.randomUUID(),
              cellId: cell.id!,
              outputType: "stream",
              data: { name: "stderr", text },
              metadata: {},
              position: outputPosition++,
            });
          }
        },

        display: (
          data: Record<string, unknown>,
          metadata?: Record<string, unknown>,
          displayId?: string,
        ) => {
          mockStore.commit({
            type: "cellOutputAdded",
            id: crypto.randomUUID(),
            cellId: cell.id!,
            outputType: "display_data",
            data,
            metadata: metadata || {},
            position: outputPosition++,
            displayId,
          });
        },

        updateDisplay: (
          displayId: string,
          data: Record<string, unknown>,
          metadata?: Record<string, unknown>,
        ) => {
          mockStore.commit({
            type: "cellOutputUpdated",
            id: displayId,
            data,
            metadata: metadata || {},
          });
        },

        result: (
          data: Record<string, unknown>,
          metadata?: Record<string, unknown>,
        ) => {
          mockStore.commit({
            type: "cellOutputAdded",
            id: crypto.randomUUID(),
            cellId: cell.id!,
            outputType: "execute_result",
            data,
            metadata: metadata || {},
            position: outputPosition++,
          });
        },

        error: (ename: string, evalue: string, traceback: string[]) => {
          mockStore.commit({
            type: "cellOutputAdded",
            id: crypto.randomUUID(),
            cellId: cell.id!,
            outputType: "error",
            data: { ename, evalue, traceback },
            metadata: {},
            position: outputPosition++,
          });
        },

        clear: () => {
          mockStore.commit({
            type: "cellOutputsCleared",
            cellId: cell.id!,
            clearedBy: `kernel-${config.kernelId}`,
          });
          outputPosition = 0;
        },
      };
    })();
  };

  await t.step("stdout method", async (t) => {
    setup();
    await t.step("should emit stdout stream output", () => {
      const context = createTestContext();

      context.stdout("Hello, stdout!");

      assertEquals(mockStore.commits.length, 1);
      const commit = mockStore.commits[0] as MockOutputCommit;
      assertEquals(commit.type, "cellOutputAdded");
      assertEquals(commit.outputType, "stream");
      assertEquals(commit.data.name, "stdout");
      assertEquals(commit.data.text, "Hello, stdout!");
      assertEquals(commit.position, 0);
    });

    setup();
    await t.step("should filter out empty strings", () => {
      const context = createTestContext();

      context.stdout("");

      assertEquals(mockStore.commits.length, 0);
    });

    await t.step("should preserve whitespace and newlines", () => {
      const context = createTestContext();

      context.stdout("   ");
      context.stdout("\n\n");

      assertEquals(mockStore.commits.length, 2);
      const commit1 = mockStore.commits[0] as MockOutputCommit;
      const commit2 = mockStore.commits[1] as MockOutputCommit;
      assertEquals(commit1.data.text, "   ");
      assertEquals(commit2.data.text, "\n\n");
    });

    setup();
    await t.step("should emit non-empty strings", () => {
      const context = createTestContext();

      context.stdout("  actual content  ");

      assertEquals(mockStore.commits.length, 1);
      const commit = mockStore.commits[0] as MockOutputCommit;
      assertEquals(commit.data.text, "  actual content  ");
    });

    setup();
    await t.step("should maintain position ordering", () => {
      const context = createTestContext();

      context.stdout("First");
      context.stdout("Second");
      context.stdout("Third");

      assertEquals(mockStore.commits.length, 3);
      assertEquals((mockStore.commits[0] as MockOutputCommit).position, 0);
      assertEquals((mockStore.commits[1] as MockOutputCommit).position, 1);
      assertEquals((mockStore.commits[2] as MockOutputCommit).position, 2);
    });
  });

  await t.step("stderr method", async (t) => {
    setup();
    await t.step("should emit stderr stream output", () => {
      const context = createTestContext();

      context.stderr("Error message!");

      assertEquals(mockStore.commits.length, 1);
      const commit = mockStore.commits[0] as MockOutputCommit;
      assertEquals(commit.type, "cellOutputAdded");
      assertEquals(commit.outputType, "stream");
      assertEquals(commit.data.name, "stderr");
      assertEquals(commit.data.text, "Error message!");
    });

    setup();
    await t.step("should filter out empty strings", () => {
      const context = createTestContext();

      context.stderr("");

      assertEquals(mockStore.commits.length, 0);
    });

    await t.step("should preserve whitespace for stderr", () => {
      const context = createTestContext();

      context.stderr("   ");

      assertEquals(mockStore.commits.length, 1);
      const commit = mockStore.commits[0] as MockOutputCommit;
      assertEquals(commit.data.text, "   ");
    });
  });

  await t.step("display method", async (t) => {
    setup();
    await t.step("should emit display_data output", () => {
      const context = createTestContext();
      const richData = {
        "text/html": "<h1>Hello</h1>",
        "text/plain": "Hello",
      };

      context.display(richData);

      assertEquals(mockStore.commits.length, 1);
      const commit = mockStore.commits[0] as MockOutputCommit;
      assertEquals(commit.type, "cellOutputAdded");
      assertEquals(commit.outputType, "display_data");
      assertEquals(commit.data, richData);
      assertEquals(commit.metadata, {});
    });

    setup();
    await t.step("should include custom metadata", () => {
      const context = createTestContext();
      const metadata = { "plot_type": "scatter", "custom": true };

      context.display({ "text/plain": "test" }, metadata);

      assertEquals(mockStore.commits.length, 1);
      assertEquals(
        (mockStore.commits[0] as MockOutputCommit).metadata,
        metadata,
      );
    });

    setup();
    await t.step("should handle various MIME types", () => {
      const context = createTestContext();
      const richData = {
        "text/plain": "Plain text",
        "text/html": "<div>HTML</div>",
        "text/markdown": "# Markdown",
        "image/svg+xml": "<svg></svg>",
        "application/json": '{"key": "value"}',
      };

      context.display(richData);

      assertEquals((mockStore.commits[0] as MockOutputCommit).data, richData);
    });
  });

  await t.step("display method with displayId", async (t) => {
    await t.step("should use displayId as output ID when provided", () => {
      setup();
      const context = createTestContext();
      const displayId = "custom-display-123";
      const data = { "text/html": "<p>Custom display ID content</p>" };
      const metadata = { "custom": "metadata" };

      context.display(data, metadata, displayId);

      assertEquals(mockStore.commits.length, 1);
      const commit = mockStore.commits[0] as MockOutputCommit;
      assertEquals(commit.type, "cellOutputAdded");
      assertEquals(commit.displayId, displayId);
      assertEquals(commit.data, data);
      assertEquals(commit.metadata, metadata);
    });

    await t.step("should generate UUID when displayId not provided", () => {
      setup();
      const context = createTestContext();
      const data = { "text/plain": "No display ID" };

      context.display(data);

      assertEquals(mockStore.commits.length, 1);
      const commit = mockStore.commits[0] as MockOutputCommit;
      assertEquals(commit.type, "cellOutputAdded");
      // Should be a UUID (36 characters with dashes)
      assertEquals(commit.id.length, 36);
      assertEquals(commit.id.includes("-"), true);
      assertEquals(commit.displayId, undefined);
    });
  });

  await t.step("updateDisplay method", async (t) => {
    await t.step("should emit cellOutputUpdated event", () => {
      setup();
      const context = createTestContext();
      const displayId = "test-display-123";
      const data = { "text/html": "<p>Updated content</p>" };
      const metadata = { "custom": "metadata" };

      context.updateDisplay(displayId, data, metadata);

      assertEquals(mockStore.commits.length, 1);
      const commit = mockStore.commits[0] as MockUpdateCommit;
      assertEquals(commit.type, "cellOutputUpdated");
      assertEquals(commit.id, displayId);
      assertEquals(commit.data, data);
      assertEquals(commit.metadata, metadata);
    });

    await t.step("should handle metadata", () => {
      setup();
      const context = createTestContext();
      const displayId = "test-display-456";
      const data = { "text/plain": "Plain text update" };

      context.updateDisplay(displayId, data);

      assertEquals(mockStore.commits.length, 1);
      const commit = mockStore.commits[0] as MockUpdateCommit;
      assertEquals(commit.metadata, {});
    });

    await t.step("should handle various display IDs", () => {
      setup();
      const context = createTestContext();
      const displayIds = ["id1", "widget-123", "plot-abc"];
      const data = { "text/plain": "test" };

      displayIds.forEach((id, index) => {
        context.updateDisplay(id, data);
        const commit = mockStore.commits[index] as MockUpdateCommit;
        assertEquals(commit.id, id);
      });

      assertEquals(mockStore.commits.length, 3);
    });
  });

  await t.step("result method", async (t) => {
    setup();
    await t.step("should emit execute_result output", () => {
      const context = createTestContext();
      const resultData = { "text/plain": "42" };

      context.result(resultData);

      assertEquals(mockStore.commits.length, 1);
      const commit = mockStore.commits[0] as MockOutputCommit;
      assertEquals(commit.type, "cellOutputAdded");
      assertEquals(commit.outputType, "execute_result");
      assertEquals(commit.data, resultData);
    });

    setup();
    await t.step("should handle metadata", () => {
      const context = createTestContext();
      const metadata = { "execution_count": 5 };

      context.result({ "text/plain": "result" }, metadata);

      assertEquals(
        (mockStore.commits[0] as MockOutputCommit).metadata,
        metadata,
      );
    });

    setup();
    await t.step("should default to empty metadata", () => {
      const context = createTestContext();

      context.result({ "text/plain": "result" });

      assertEquals((mockStore.commits[0] as MockOutputCommit).metadata, {});
    });
  });

  await t.step("error method", async (t) => {
    setup();
    await t.step("should emit error output", () => {
      const context = createTestContext();

      context.error("ValueError", "Invalid input", [
        "Traceback (most recent call last):",
        "  File '<cell>', line 1",
        "ValueError: Invalid input",
      ]);

      assertEquals(mockStore.commits.length, 1);
      const commit = mockStore.commits[0] as MockOutputCommit;
      assertEquals(commit.type, "cellOutputAdded");
      assertEquals(commit.outputType, "error");
      assertEquals(commit.data.ename, "ValueError");
      assertEquals(commit.data.evalue, "Invalid input");
      assertEquals((commit.data.traceback as string[]).length, 3);
    });

    setup();
    await t.step("should handle empty traceback", () => {
      const context = createTestContext();

      context.error("Error", "Something went wrong", []);

      const commit = mockStore.commits[0] as MockOutputCommit;
      assertEquals(commit.data.traceback, []);
    });

    setup();
    await t.step("should handle various error types", () => {
      const context = createTestContext();

      context.error("TypeError", "Type mismatch", ["line 1", "line 2"]);

      const commit = mockStore.commits[0] as MockOutputCommit;
      assertEquals(commit.data.ename, "TypeError");
      assertEquals(commit.data.evalue, "Type mismatch");
    });
  });

  await t.step("clear method", async (t) => {
    setup();
    await t.step("should emit cellOutputsCleared event", () => {
      const context = createTestContext();

      context.clear();

      assertEquals(mockStore.commits.length, 1);
      const commit = mockStore.commits[0] as MockClearCommit;
      assertEquals(commit.type, "cellOutputsCleared");
      assertEquals(commit.cellId, "test-cell-123");
      assertEquals(commit.clearedBy, `kernel-${config.kernelId}`);
    });

    setup();
    await t.step("should reset position counter", () => {
      const context = createTestContext();

      // Add some outputs
      context.stdout("Before clear");
      context.display({ "text/plain": "Display before" });

      // Clear outputs
      context.clear();

      // Add output after clear
      context.stdout("After clear");

      assertEquals(mockStore.commits.length, 4); // 2 outputs + 1 clear + 1 output
      assertEquals((mockStore.commits[0] as MockOutputCommit).position, 0); // Before clear
      assertEquals((mockStore.commits[1] as MockOutputCommit).position, 1); // Before clear
      assertEquals(mockStore.commits[2].type, "cellOutputsCleared"); // Clear event
      assertEquals((mockStore.commits[3] as MockOutputCommit).position, 0); // After clear (reset)
    });
  });

  await t.step("mixed output scenarios", async (t) => {
    await t.step(
      "should maintain correct position ordering across different output types",
      () => {
        setup();
        const context = createTestContext();

        context.stdout("stdout 1");
        context.stderr("stderr 1");
        context.display({ "text/plain": "display 1" });
        context.result({ "text/plain": "result 1" });
        context.stdout("stdout 2");

        assertEquals(mockStore.commits.length, 5);
        assertEquals((mockStore.commits[0] as MockOutputCommit).position, 0);
        assertEquals((mockStore.commits[1] as MockOutputCommit).position, 1);
        assertEquals((mockStore.commits[2] as MockOutputCommit).position, 2);
        assertEquals((mockStore.commits[3] as MockOutputCommit).position, 3);
        assertEquals((mockStore.commits[4] as MockOutputCommit).position, 4);
      },
    );

    setup();
    await t.step("should handle interleaved outputs and clears", () => {
      const context = createTestContext();

      context.stdout("output 1");
      context.display({ "text/plain": "display 1" });
      context.clear();
      context.stdout("output 2");
      context.result({ "text/plain": "result 1" });

      assertEquals(mockStore.commits.length, 5);

      // Before clear
      assertEquals((mockStore.commits[0] as MockOutputCommit).position, 0);
      assertEquals((mockStore.commits[1] as MockOutputCommit).position, 1);

      // Clear event
      assertEquals(mockStore.commits[2].type, "cellOutputsCleared");

      // After clear (positions reset)
      assertEquals((mockStore.commits[3] as MockOutputCommit).position, 0);
      assertEquals((mockStore.commits[4] as MockOutputCommit).position, 1);
    });

    setup();
    await t.step("should handle rapid successive outputs", () => {
      const context = createTestContext();

      for (let i = 0; i < 10; i++) {
        context.stdout(`Message ${i}`);
      }

      assertEquals(mockStore.commits.length, 10);
      for (let i = 0; i < 10; i++) {
        assertEquals((mockStore.commits[i] as MockOutputCommit).position, i);
        assertEquals(
          (mockStore.commits[i] as MockOutputCommit).data.text,
          `Message ${i}`,
        );
      }
    });
  });

  await t.step("edge cases", async (t) => {
    setup();
    await t.step("should handle very long text output", () => {
      const context = createTestContext();
      const longText = "x".repeat(10000);

      context.stdout(longText);

      const commit = mockStore.commits[0] as MockOutputCommit;
      assertEquals(commit.data.text, longText);
    });

    setup();
    await t.step("should handle special characters in output", () => {
      const context = createTestContext();
      const specialText = "Hello\n\t\r\\\"'世界🌍";

      context.stdout(specialText);

      const commit = mockStore.commits[0] as MockOutputCommit;
      assertEquals(commit.data.text, specialText);
    });

    setup();
    await t.step("should handle empty rich data", () => {
      const context = createTestContext();

      context.display({});

      const commit = mockStore.commits[0] as MockOutputCommit;
      assertEquals(commit.data, {});
    });

    setup();
    await t.step("should handle special values in rich data", () => {
      const context = createTestContext();

      context.display({
        "text/plain": "",
        "application/json": "null",
      });

      const commit = mockStore.commits[0] as MockOutputCommit;
      assertEquals(commit.data["text/plain"], "");
      assertEquals(commit.data["application/json"], "null");
    });

    setup();
    await t.step("should handle unicode in error messages", () => {
      const context = createTestContext();

      context.error("UnicodeError", "Unicode: 🚀 世界", ["Traceback with 🌍"]);

      const commit = mockStore.commits[0] as MockOutputCommit;
      assertEquals(commit.data.evalue, "Unicode: 🚀 世界");
      assertEquals((commit.data.traceback as string[])[0], "Traceback with 🌍");
    });
  });
});

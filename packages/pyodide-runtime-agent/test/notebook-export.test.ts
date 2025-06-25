// Notebook Export Tests
//
// Tests for the notebook export functionality that converts LiveStore
// notebook data to standard Jupyter notebook (.ipynb) format.

import { assertEquals, assertExists } from "jsr:@std/assert";
import { delay } from "jsr:@std/async/delay";
import { crypto } from "jsr:@std/crypto";
import { PyodideRuntimeAgent } from "../src/pyodide-agent.ts";
import { events } from "@runt/schema";
import { NotebookExporter } from "../src/notebook-exporter.ts";

Deno.test({
  name: "NotebookExporter - Export Functionality",
  sanitizeOps: false,
  sanitizeResources: false,
}, async (t) => {
  let agent: PyodideRuntimeAgent | undefined;
  let exporter: NotebookExporter | undefined;
  const notebookId = crypto.randomUUID();

  try {
    await t.step("setup test agent and data", async () => {
      const kernelId = `kernel-${crypto.randomUUID()}`;

      const agentArgs = [
        "--kernel-id",
        kernelId,
        "--notebook",
        notebookId,
        "--auth-token",
        "test-token",
        "--sync-url",
        "ws://localhost:9999", // In-memory only
      ];

      agent = new PyodideRuntimeAgent(agentArgs, {
        enableNotebookExport: false, // Disable automatic export for testing
      });

      await agent.start();
      await delay(500); // Give it time to initialize

      const store = agent.store;

      // Initialize notebook
      store.commit(events.notebookInitialized({
        id: notebookId,
        title: "Test Notebook",
        ownerId: "test-user",
      }));

      // Note: kernel type is set during kernel session start

      // Create test cells
      store.commit(events.cellCreated({
        id: "cell-1",
        position: 1,
        cellType: "markdown",
        createdBy: "test-user",
      }));

      store.commit(events.cellSourceChanged({
        id: "cell-1",
        source: "# Test Notebook\n\nThis is a test markdown cell.",
        modifiedBy: "test-user",
      }));

      store.commit(events.cellCreated({
        id: "cell-2",
        position: 2,
        cellType: "code",
        createdBy: "test-user",
      }));

      store.commit(events.cellSourceChanged({
        id: "cell-2",
        source: "print('Hello, World!')\nx = 42\nprint(f'The answer is {x}')",
        modifiedBy: "test-user",
      }));

      // Note: execution count is tracked through execution events

      store.commit(events.cellCreated({
        id: "cell-3",
        position: 3,
        cellType: "ai",
        createdBy: "test-user",
      }));

      store.commit(events.cellSourceChanged({
        id: "cell-3",
        source: "What is the meaning of life?",
        modifiedBy: "test-user",
      }));

      // Note: execution count is tracked through execution events

      store.commit(events.cellCreated({
        id: "cell-4",
        position: 4,
        cellType: "sql",
        createdBy: "test-user",
      }));

      store.commit(events.cellSourceChanged({
        id: "cell-4",
        source: "SELECT * FROM users WHERE active = 1;",
        modifiedBy: "test-user",
      }));

      // Note: execution count is tracked through execution events

      // Create some outputs for the code cell
      store.commit(events.cellOutputAdded({
        id: "output-1",
        cellId: "cell-2",
        outputType: "stream",
        data: { name: "stdout", text: "Hello, World!" },
        position: 1,
      }));

      store.commit(events.cellOutputAdded({
        id: "output-2",
        cellId: "cell-2",
        outputType: "execute_result",
        data: { "text/plain": "42" },
        position: 2,
      }));

      // Create outputs for AI cell
      store.commit(events.cellOutputAdded({
        id: "output-3",
        cellId: "cell-3",
        outputType: "display_data",
        data: { "text/markdown": "The meaning of life is **42**!" },
        position: 1,
      }));

      exporter = new NotebookExporter(store, notebookId);
    });

    await t.step("should export basic notebook structure", () => {
      if (!exporter) throw new Error("Exporter not initialized");

      const notebook = exporter.exportNotebook();

      assertEquals(notebook.nbformat, 4);
      assertEquals(notebook.nbformat_minor, 4);
      assertEquals(notebook.metadata.kernelspec.name, "python3-pyodide");
      assertEquals(notebook.metadata.kernelspec.language, "python");
      assertEquals(notebook.metadata.runt?.notebook_id, notebookId);
      assertExists(notebook.metadata.runt?.exported_at);
    });

    await t.step("should convert cells correctly", () => {
      if (!exporter) throw new Error("Exporter not initialized");

      const notebook = exporter.exportNotebook();

      assertEquals(notebook.cells.length, 4);

      // Check markdown cell
      const markdownCell = notebook.cells[0];
      assertExists(markdownCell);
      assertEquals(markdownCell.cell_type, "markdown");
      assertEquals(markdownCell.id, "cell-1");
      assertEquals(markdownCell.source[0], "# Test Notebook\n");

      // Check code cell
      const codeCell = notebook.cells[1];
      assertExists(codeCell);
      assertEquals(codeCell.cell_type, "code");
      assertEquals(codeCell.id, "cell-2");
      assertEquals(codeCell.execution_count, null); // No execution count set in test
      assertEquals(codeCell.source[0], "print('Hello, World!')\n");
      assertEquals(codeCell.outputs?.length, 2);

      // Check outputs
      const streamOutput = codeCell.outputs?.[0];
      assertEquals(streamOutput?.output_type, "stream");
      assertEquals(
        (streamOutput as { name?: string })?.name,
        "stdout",
      );

      const executeResultOutput = codeCell.outputs?.[1];
      assertEquals(executeResultOutput?.output_type, "execute_result");
      assertEquals(
        (executeResultOutput as { data?: Record<string, unknown> })?.data
          ?.["text/plain"],
        "42",
      );
    });

    await t.step(
      "should transform AI cells to Python with chat() wrapper",
      () => {
        if (!exporter) throw new Error("Exporter not initialized");

        const notebook = exporter.exportNotebook({
          transformSources: true,
        });

        const aiCell = notebook.cells[2];
        assertExists(aiCell);
        assertEquals(aiCell.cell_type, "code");
        assertEquals(
          aiCell.source[0],
          `chat("""What is the meaning of life?""")`,
        );
        assertEquals(aiCell.execution_count, null); // No execution count set
        assertEquals(aiCell.outputs?.length, 1);
      },
    );

    await t.step(
      "should transform SQL cells to Python with sql() wrapper",
      () => {
        if (!exporter) throw new Error("Exporter not initialized");

        const notebook = exporter.exportNotebook({
          transformSources: true,
        });

        const sqlCell = notebook.cells[3];
        assertExists(sqlCell);
        assertEquals(sqlCell.cell_type, "code");
        assertEquals(
          sqlCell.source[0],
          `sql("""SELECT * FROM users WHERE active = 1;""")`,
        );
        assertEquals(sqlCell.execution_count, null); // No execution count set
      },
    );

    await t.step(
      "should preserve AI cells as markdown when not transforming",
      () => {
        if (!exporter) throw new Error("Exporter not initialized");

        const notebook = exporter.exportNotebook({
          transformSources: false,
        });

        const aiCell = notebook.cells[2];
        assertExists(aiCell);
        assertEquals(aiCell.cell_type, "markdown");
        assertEquals(aiCell.source[0], "**AI Cell:**\n");
        assertEquals(aiCell.source[1], "What is the meaning of life?");
        assertEquals(
          (aiCell.metadata as { tags?: string[] })?.tags,
          [
            "ai-cell",
          ],
        );
      },
    );

    await t.step("should exclude AI cells when configured", () => {
      if (!exporter) throw new Error("Exporter not initialized");

      const notebook = exporter.exportNotebook({ includeAiCells: false });

      assertEquals(notebook.cells.length, 3);

      // Should not contain AI cell
      const hasChatWrapper = notebook.cells.some((cell) =>
        cell.source.some((line) =>
          typeof line === "string" && line.includes("chat(")
        )
      );
      assertEquals(hasChatWrapper, false);
    });

    await t.step("should exclude SQL cells when configured", () => {
      if (!exporter) throw new Error("Exporter not initialized");

      const notebook = exporter.exportNotebook({
        includeSqlCells: false,
      });

      assertEquals(notebook.cells.length, 3);

      // Should not contain SQL cell
      const hasSqlWrapper = notebook.cells.some((cell) =>
        cell.source.some((line) =>
          typeof line === "string" && line.includes("sql(")
        )
      );
      assertEquals(hasSqlWrapper, false);
    });

    await t.step("should generate appropriate filename", () => {
      if (!exporter) throw new Error("Exporter not initialized");

      const filename = exporter.generateFilename();
      assertEquals(filename, "test-notebook.ipynb");
    });

    await t.step("should handle special characters in title", () => {
      if (!agent) throw new Error("Agent not initialized");

      const store = agent.store;

      // Change notebook title with special characters
      store.commit(events.notebookTitleChanged({
        title: "My Awesome Notebook! (with special chars)",
      }));

      if (!exporter) throw new Error("Exporter not initialized");

      const filename = exporter.generateFilename();
      assertEquals(filename, "my-awesome-notebook-with-special-chars.ipynb");
    });

    await t.step("should write to file", async () => {
      if (!exporter) throw new Error("Exporter not initialized");

      const tempFile = await Deno.makeTempFile({ suffix: ".ipynb" });

      try {
        await exporter.writeToFile(tempFile);

        const content = await Deno.readTextFile(tempFile);
        const parsed = JSON.parse(content);

        assertEquals(parsed.nbformat, 4);
        assertEquals(parsed.cells.length, 4);
        assertExists(parsed.metadata.runt);
      } finally {
        await Deno.remove(tempFile);
      }
    });

    await t.step("should handle cells with complex outputs", () => {
      if (!agent || !exporter) {
        throw new Error("Agent/Exporter not initialized");
      }

      const store = agent.store;

      // Add a cell with rich display data
      store.commit(events.cellCreated({
        id: "rich-cell",
        position: 5,
        cellType: "code",
        createdBy: "test-user",
      }));

      store.commit(events.cellSourceChanged({
        id: "rich-cell",
        source: "import matplotlib.pyplot as plt\nplt.plot([1,2,3])",
        modifiedBy: "test-user",
      }));

      // Note: execution count is tracked through execution events

      store.commit(events.cellOutputAdded({
        id: "rich-output",
        cellId: "rich-cell",
        outputType: "display_data",
        data: {
          "text/plain": "<Figure size 640x480 with 1 Axes>",
          "image/svg+xml": "<svg>...</svg>",
          "application/json": { "plot_data": [1, 2, 3] },
        },
        metadata: { "image/svg+xml": { "width": 640, "height": 480 } },
        position: 1,
      }));

      const notebook = exporter.exportNotebook();
      const richCell = notebook.cells[4];

      assertExists(richCell);
      assertEquals(richCell.outputs?.length, 1);
      const richOutput = richCell.outputs?.[0];
      assertEquals(richOutput?.output_type, "display_data");
      assertEquals(
        (richOutput as { data?: Record<string, unknown> })?.data
          ?.["text/plain"],
        "<Figure size 640x480 with 1 Axes>",
      );
      assertEquals(
        (richOutput as { data?: Record<string, unknown> })?.data
          ?.["image/svg+xml"],
        "<svg>...</svg>",
      );
      assertExists(
        (richOutput as { metadata?: Record<string, unknown> })?.metadata,
      );
    });

    await t.step("should handle error outputs", () => {
      if (!agent || !exporter) {
        throw new Error("Agent/Exporter not initialized");
      }

      const store = agent.store;

      // Add a cell with error output
      store.commit(events.cellCreated({
        id: "error-cell",
        position: 6,
        cellType: "code",
        createdBy: "test-user",
      }));

      store.commit(events.cellSourceChanged({
        id: "error-cell",
        source: "raise ValueError('Test error')",
        modifiedBy: "test-user",
      }));

      // Note: execution count is tracked through execution events

      store.commit(events.cellOutputAdded({
        id: "error-output",
        cellId: "error-cell",
        outputType: "error",
        data: {
          ename: "ValueError",
          evalue: "Test error",
          traceback: [
            "Traceback (most recent call last):",
            '  File "<stdin>", line 1, in <module>',
            "ValueError: Test error",
          ],
        },
        position: 1,
      }));

      const notebook = exporter.exportNotebook();
      const errorCell = notebook.cells[5];

      assertExists(errorCell);
      assertEquals(errorCell.outputs?.length, 1);
      const errorOutput = errorCell.outputs?.[0];
      assertEquals(errorOutput?.output_type, "error");
      assertEquals(
        (errorOutput as { ename?: string })?.ename,
        "ValueError",
      );
      assertEquals(
        (errorOutput as { evalue?: string })?.evalue,
        "Test error",
      );
      assertEquals(
        (errorOutput as { traceback?: string[] })?.traceback?.length,
        3,
      );
    });
  } finally {
    // Always cleanup
    if (agent) {
      await agent.shutdown();
    }
  }
});

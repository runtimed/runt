// Notebook Export Example
//
// This example demonstrates how to use the notebook export functionality
// to periodically save your notebook as a .ipynb file compatible with Jupyter.

import { delay } from "jsr:@std/async/delay";
import { crypto } from "jsr:@std/crypto";
import { PyodideRuntimeAgent } from "../src/pyodide-agent.ts";
import { events } from "@runt/schema";

async function main() {
  console.log("🚀 Starting Notebook Export Example");

  const notebookId = `example-${crypto.randomUUID()}`;
  const kernelId = `kernel-${crypto.randomUUID()}`;

  // Create agent with notebook export enabled
  const agent = new PyodideRuntimeAgent([
    "--kernel-id",
    kernelId,
    "--notebook",
    notebookId,
    "--auth-token",
    "example-token",
    "--sync-url",
    "ws://localhost:9999", // In-memory only for example
  ], {
    enableNotebookExport: true,
    exportIntervalMs: 10000, // Export every 10 seconds
    exportOptions: {
      includeAiCells: true,
      includeSqlCells: true,
      transformSources: true, // Transform AI/SQL cells to Python
    },
  });

  try {
    await agent.start();
    console.log("✅ Agent started successfully");

    // Initialize notebook
    const store = agent.store;
    store.commit(events.notebookInitialized({
      id: notebookId,
      title: "Export Example Notebook",
      ownerId: "example-user",
    }));

    console.log("📓 Creating example notebook content...");

    // Create a markdown cell
    store.commit(events.cellCreated({
      id: "intro-cell",
      position: 1,
      cellType: "markdown",
      createdBy: "example-user",
    }));

    store.commit(events.cellSourceChanged({
      id: "intro-cell",
      source:
        "# Notebook Export Example\n\nThis notebook demonstrates the export functionality.",
      modifiedBy: "example-user",
    }));

    // Create a Python code cell
    store.commit(events.cellCreated({
      id: "code-cell",
      position: 2,
      cellType: "code",
      createdBy: "example-user",
    }));

    store.commit(events.cellSourceChanged({
      id: "code-cell",
      source:
        "import numpy as np\nprint('NumPy version:', np.__version__)\ndata = np.array([1, 2, 3, 4, 5])\nprint('Mean:', data.mean())",
      modifiedBy: "example-user",
    }));

    // Create an AI cell
    store.commit(events.cellCreated({
      id: "ai-cell",
      position: 3,
      cellType: "ai",
      createdBy: "example-user",
    }));

    store.commit(events.cellSourceChanged({
      id: "ai-cell",
      source: "Explain what this numpy code does in simple terms",
      modifiedBy: "example-user",
    }));

    // Create a SQL cell
    store.commit(events.cellCreated({
      id: "sql-cell",
      position: 4,
      cellType: "sql",
      createdBy: "example-user",
    }));

    store.commit(events.cellSourceChanged({
      id: "sql-cell",
      source: "SELECT name, age FROM users WHERE age > 21 ORDER BY age;",
      modifiedBy: "example-user",
    }));

    // Add some sample outputs
    store.commit(events.cellOutputAdded({
      id: "code-output-1",
      cellId: "code-cell",
      outputType: "stream",
      data: { name: "stdout", text: "NumPy version: 1.24.3" },
      position: 1,
    }));

    store.commit(events.cellOutputAdded({
      id: "code-output-2",
      cellId: "code-cell",
      outputType: "execute_result",
      data: { "text/plain": "3.0" },
      position: 2,
    }));

    console.log("📝 Notebook content created");

    // Wait for first automatic export
    console.log("⏳ Waiting for automatic export (10 seconds)...");
    await delay(12000);

    // Demonstrate manual export
    console.log("📤 Performing manual export...");
    const exportPath = await agent.exportNotebook("manual-export.ipynb", {
      includeAiCells: true,
      includeSqlCells: true,
      transformSources: true,
    });

    if (exportPath) {
      console.log(`✅ Manual export completed: ${exportPath}`);

      // Show the exported content
      try {
        const content = await Deno.readTextFile(exportPath);
        const notebook = JSON.parse(content);

        console.log("\n📋 Exported notebook summary:");
        console.log(
          `   Format: Jupyter Notebook v${notebook.nbformat}.${notebook.nbformat_minor}`,
        );
        console.log(`   Kernel: ${notebook.metadata.kernelspec.display_name}`);
        console.log(`   Cells: ${notebook.cells.length}`);
        console.log(`   Export time: ${notebook.metadata.runt?.exported_at}`);

        console.log("\n🔍 Cell types in exported notebook:");
        notebook.cells.forEach((cell: Record<string, unknown>, i: number) => {
          const sourcePreview = Array.isArray(cell.source)
            ? cell.source[0]?.substring(0, 50) + "..."
            : String(cell.source).substring(0, 50) + "...";
          console.log(`   ${i + 1}. ${cell.cell_type}: ${sourcePreview}`);
        });

        // Show how AI and SQL cells were transformed
        const transformedCells = notebook.cells.filter((
          cell: Record<string, unknown>,
        ) =>
          Array.isArray(cell.source) &&
          cell.source.some((line: string) =>
            line.includes("chat(") || line.includes("sql(")
          )
        );

        if (transformedCells.length > 0) {
          console.log("\n🔄 Transformed cells (AI/SQL → Python):");
          transformedCells.forEach(
            (cell: Record<string, unknown>, i: number) => {
              const source = Array.isArray(cell.source)
                ? cell.source.join("")
                : cell.source;
              console.log(`   ${i + 1}. ${source}`);
            },
          );
        }
      } catch (error) {
        console.error("❌ Failed to read exported file:", error);
      }
    }

    // Wait a bit more to see periodic export in action
    console.log("\n⏳ Waiting for another automatic export...");
    await delay(15000);

    console.log("\n✅ Example completed successfully!");
    console.log("\n💡 Key features demonstrated:");
    console.log("   • Automatic periodic export every 10 seconds");
    console.log("   • Manual export on demand");
    console.log("   • AI cells transformed to chat() Python calls");
    console.log("   • SQL cells transformed to sql() Python calls");
    console.log("   • Full Jupyter notebook compatibility");
    console.log("   • Preserved outputs and metadata");
  } catch (error) {
    console.error("❌ Example failed:", error);
  } finally {
    await agent.shutdown();
    console.log("🛑 Agent shutdown complete");
  }
}

if (import.meta.main) {
  await main();
}

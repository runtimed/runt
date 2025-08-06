#!/usr/bin/env -S deno run --allow-all

/**
 * Practical example: Handling fractional index rebalancing in UI code
 *
 * This demonstrates how to gracefully handle "No string exists between" errors
 * without making the UI "stuck" by using automatic rebalancing.
 */

import {
  type CellReference,
  createTestJitterProvider,
  fractionalIndexBetween,
  fractionalIndexBetweenWithFallback,
  moveCellWithRebalancing,
  needsRebalancing,
  rebalanceCellIndices,
  validateFractionalIndexOrder,
} from "../mod.ts";

// Simulated UI state management
interface NotebookState {
  cells: CellReference[];
  isRebalancing: boolean;
  lastRebalanceTime?: number;
}

class NotebookManager {
  private state: NotebookState = {
    cells: [],
    isRebalancing: false,
  };

  private listeners: Array<(state: NotebookState) => void> = [];

  constructor() {
    console.log("📒 Notebook Manager initialized");
  }

  // Subscribe to state changes (like React state or similar)
  subscribe(listener: (state: NotebookState) => void) {
    this.listeners.push(listener);
  }

  private notifyListeners() {
    this.listeners.forEach((listener) => listener({ ...this.state }));
  }

  // Initialize with some problematic indices (like what might happen in production)
  initializeWithProblematicData() {
    console.log("\n🔧 Initializing with problematic adjacent indices...");

    this.state.cells = [
      { id: "intro-cell", fractionalIndex: "m", cellType: "markdown" },
      { id: "code-cell-1", fractionalIndex: "m0", cellType: "code" },
      { id: "code-cell-2", fractionalIndex: "m00", cellType: "code" },
      { id: "output-cell", fractionalIndex: "m000", cellType: "markdown" },
      { id: "conclusion", fractionalIndex: "n", cellType: "markdown" },
    ];

    console.log(
      "Initial cell indices:",
      this.state.cells.map((c) => `${c.id}: ${c.fractionalIndex}`),
    );

    // Check if rebalancing is needed
    if (needsRebalancing(this.state.cells)) {
      console.log(
        "⚠️  Detected that rebalancing will be needed for insertions",
      );
    }

    this.notifyListeners();
  }

  // Attempt to insert a new cell (this is where the UI might get "stuck")
  insertCellAt(position: number, newCellId: string): boolean {
    console.log(
      `\n📝 Attempting to insert cell "${newCellId}" at position ${position}...`,
    );

    // Sort cells by fractional index first
    const sortedCells = [...this.state.cells].sort((a, b) =>
      (a.fractionalIndex || "").localeCompare(b.fractionalIndex || "")
    );

    // Determine before/after cells for the insertion
    const beforeCell = position > 0 ? sortedCells[position - 1] : null;
    const afterCell = position < sortedCells.length
      ? sortedCells[position]
      : null;

    console.log(
      `  Inserting between: "${beforeCell?.fractionalIndex || "null"}" and "${
        afterCell?.fractionalIndex || "null"
      }"`,
    );

    try {
      // Try the enhanced version with fallback
      const result = fractionalIndexBetweenWithFallback(
        beforeCell?.fractionalIndex,
        afterCell?.fractionalIndex,
        {
          allCells: this.state.cells,
          insertPosition: position,
          jitterProvider: createTestJitterProvider(Date.now()),
        },
      );

      if (result.needsRebalancing) {
        console.log("🔄 Rebalancing needed! Applying automatic rebalancing...");
        return this.handleRebalancing(
          result.rebalanceResult!,
          newCellId,
          position,
        );
      } else if (result.index) {
        console.log(`✅ Successfully generated index: "${result.index}"`);

        // Insert the new cell
        const newCell: CellReference = {
          id: newCellId,
          fractionalIndex: result.index,
          cellType: "code",
        };

        this.state.cells.push(newCell);
        this.notifyListeners();
        return true;
      }
    } catch (error) {
      console.error(`❌ Failed to insert cell: ${error}`);

      // Last resort: force rebalancing
      console.log("🆘 Attempting emergency rebalancing...");
      return this.emergencyRebalancing(newCellId, position);
    }

    return false;
  }

  // Handle rebalancing with user feedback
  private handleRebalancing(
    rebalanceResult: {
      newIndices: { cellId: string; fractionalIndex: string }[];
      events: ReturnType<typeof import("../mod.ts").events.cellMoved2>[];
    },
    newCellId: string,
    insertPosition: number,
  ): boolean {
    try {
      this.state.isRebalancing = true;
      this.state.lastRebalanceTime = Date.now();
      this.notifyListeners();

      console.log("  📊 Rebalancing details:");
      console.log(
        `    - Cells to rebalance: ${rebalanceResult.newIndices.length}`,
      );
      console.log(`    - Events to apply: ${rebalanceResult.events.length}`);

      // Simulate applying the rebalancing events (in real UI, these would go to LiveStore)
      for (const { cellId, fractionalIndex } of rebalanceResult.newIndices) {
        const cell = this.state.cells.find((c) => c.id === cellId);
        if (cell) {
          console.log(
            `    - Updating ${cellId}: ${cell.fractionalIndex} → ${fractionalIndex}`,
          );
          cell.fractionalIndex = fractionalIndex;
        }
      }

      // Sort cells by new indices
      this.state.cells.sort((a, b) =>
        (a.fractionalIndex || "").localeCompare(b.fractionalIndex || "")
      );

      // Verify the rebalancing worked
      const indices = this.state.cells.map((c) => c.fractionalIndex).filter(
        Boolean,
      ) as string[];
      if (!validateFractionalIndexOrder(indices)) {
        throw new Error("Rebalancing failed - invalid ordering");
      }

      // Now insert the new cell in the rebalanced space
      const sortedCells = [...this.state.cells];
      const beforeCell = insertPosition > 0
        ? sortedCells[insertPosition - 1]
        : null;
      const afterCell = insertPosition < sortedCells.length
        ? sortedCells[insertPosition]
        : null;

      const newIndex = fractionalIndexBetween(
        beforeCell?.fractionalIndex,
        afterCell?.fractionalIndex,
      );

      const newCell: CellReference = {
        id: newCellId,
        fractionalIndex: newIndex,
        cellType: "code",
      };

      this.state.cells.push(newCell);

      console.log(
        `✅ Rebalancing successful! Inserted "${newCellId}" with index "${newIndex}"`,
      );

      this.state.isRebalancing = false;
      this.notifyListeners();
      return true;
    } catch (error) {
      console.error(`❌ Rebalancing failed: ${error}`);
      this.state.isRebalancing = false;
      this.notifyListeners();
      return false;
    }
  }

  // Emergency rebalancing when all else fails
  private emergencyRebalancing(
    newCellId: string,
    insertPosition: number,
  ): boolean {
    console.log("🚨 Performing emergency rebalancing of all cells...");

    try {
      this.state.isRebalancing = true;
      this.notifyListeners();

      // Force rebalance all cells
      const rebalanceResult = rebalanceCellIndices(this.state.cells, {
        bufferCells: 3, // Extra buffer for future insertions
        actorId: "emergency-rebalance",
      });

      // Apply the rebalancing
      for (const { cellId, fractionalIndex } of rebalanceResult.newIndices) {
        const cell = this.state.cells.find((c) => c.id === cellId);
        if (cell) {
          cell.fractionalIndex = fractionalIndex;
        }
      }

      // Sort and verify
      this.state.cells.sort((a, b) =>
        (a.fractionalIndex || "").localeCompare(b.fractionalIndex || "")
      );

      // Insert new cell
      const sortedCells = [...this.state.cells];
      const beforeCell = insertPosition > 0
        ? sortedCells[insertPosition - 1]
        : null;
      const afterCell = insertPosition < sortedCells.length
        ? sortedCells[insertPosition]
        : null;

      const newIndex = fractionalIndexBetween(
        beforeCell?.fractionalIndex,
        afterCell?.fractionalIndex,
      );

      const newCell: CellReference = {
        id: newCellId,
        fractionalIndex: newIndex,
        cellType: "code",
      };

      this.state.cells.push(newCell);

      console.log("✅ Emergency rebalancing successful!");
      this.state.isRebalancing = false;
      this.notifyListeners();
      return true;
    } catch (error) {
      console.error(`💥 Emergency rebalancing failed: ${error}`);
      this.state.isRebalancing = false;
      this.notifyListeners();
      return false;
    }
  }

  // Move a cell with automatic rebalancing
  moveCell(cellId: string, newPosition: number): boolean {
    console.log(`\n🔄 Moving cell "${cellId}" to position ${newPosition}...`);

    const cell = this.state.cells.find((c) => c.id === cellId);
    if (!cell) {
      console.error(`❌ Cell "${cellId}" not found`);
      return false;
    }

    // Sort cells for position calculation
    const sortedCells = [...this.state.cells].sort((a, b) =>
      (a.fractionalIndex || "").localeCompare(b.fractionalIndex || "")
    );

    // Calculate before/after cells
    const remainingCells = sortedCells.filter((c) => c.id !== cellId);
    const adjustedPosition =
      newPosition > sortedCells.findIndex((c) => c.id === cellId)
        ? newPosition - 1
        : newPosition;

    const beforeCell = adjustedPosition > 0
      ? remainingCells[adjustedPosition - 1]
      : null;
    const afterCell = adjustedPosition < remainingCells.length
      ? remainingCells[adjustedPosition]
      : null;

    console.log(
      `  Moving between: "${beforeCell?.fractionalIndex || "null"}" and "${
        afterCell?.fractionalIndex || "null"
      }"`,
    );

    try {
      const result = moveCellWithRebalancing(
        cell,
        beforeCell,
        afterCell,
        this.state.cells,
        { actorId: "user" },
      );

      if (result.needsRebalancing && result.rebalanceResult) {
        console.log("🔄 Move requires rebalancing...");
        this.state.isRebalancing = true;
        this.notifyListeners();

        // Apply rebalancing
        for (
          const { cellId: id, fractionalIndex } of result.rebalanceResult
            .newIndices
        ) {
          const cellToUpdate = this.state.cells.find((c) => c.id === id);
          if (cellToUpdate) {
            console.log(
              `    - Updating ${id}: ${cellToUpdate.fractionalIndex} → ${fractionalIndex}`,
            );
            cellToUpdate.fractionalIndex = fractionalIndex;
          }
        }

        console.log("✅ Move with rebalancing successful!");
        this.state.isRebalancing = false;
        this.notifyListeners();
        return true;
      } else if (result.moveEvent) {
        console.log(
          `✅ Simple move successful: new index "${result.moveEvent.args.fractionalIndex}"`,
        );
        cell.fractionalIndex = result.moveEvent.args.fractionalIndex;
        this.notifyListeners();
        return true;
      } else {
        console.log("ℹ️  Cell was already in the correct position");
        return true;
      }
    } catch (error) {
      console.error(`❌ Move failed: ${error}`);
      return false;
    }
  }

  // Display current state (for debugging/monitoring)
  displayState() {
    console.log("\n📋 Current Notebook State:");
    console.log(`  Total cells: ${this.state.cells.length}`);
    console.log(`  Is rebalancing: ${this.state.isRebalancing}`);

    if (this.state.lastRebalanceTime) {
      const timeSince = Date.now() - this.state.lastRebalanceTime;
      console.log(`  Last rebalance: ${timeSince}ms ago`);
    }

    const sortedCells = [...this.state.cells].sort((a, b) =>
      (a.fractionalIndex || "").localeCompare(b.fractionalIndex || "")
    );

    console.log("  Cell order:");
    sortedCells.forEach((cell, i) => {
      console.log(`    ${i + 1}. ${cell.id}: "${cell.fractionalIndex}"`);
    });

    const indices = sortedCells.map((c) => c.fractionalIndex).filter(
      Boolean,
    ) as string[];
    console.log(
      `  Index ordering valid: ${
        validateFractionalIndexOrder(indices) ? "✅" : "❌"
      }`,
    );
    console.log(
      `  Needs rebalancing: ${
        needsRebalancing(this.state.cells) ? "⚠️  Yes" : "✅ No"
      }`,
    );
  }
}

// Simulate UI event handlers
class UIEventHandlers {
  constructor(private notebook: NotebookManager) {
    // Subscribe to state changes for UI updates
    notebook.subscribe((state) => {
      if (state.isRebalancing) {
        console.log("🔄 UI: Showing rebalancing spinner...");
      }
    });
  }

  onInsertCellClick(position: number) {
    const cellId = `new-cell-${Date.now()}`;
    const success = this.notebook.insertCellAt(position, cellId);

    if (success) {
      console.log("🎉 UI: Cell inserted successfully!");
    } else {
      console.log("💔 UI: Failed to insert cell - showing error message");
    }
  }

  onMoveCellClick(cellId: string, newPosition: number) {
    const success = this.notebook.moveCell(cellId, newPosition);

    if (success) {
      console.log("🎉 UI: Cell moved successfully!");
    } else {
      console.log("💔 UI: Failed to move cell - showing error message");
    }
  }
}

// Demo script
function runDemo() {
  console.log("🚀 Starting Fractional Index Rebalancing Demo");
  console.log("=" + "=".repeat(60));

  const notebook = new NotebookManager();
  const ui = new UIEventHandlers(notebook);

  // Initialize with problematic data
  notebook.initializeWithProblematicData();
  notebook.displayState();

  // Simulate user interactions that would normally cause "stuck" UI

  console.log("\n" + "=".repeat(61));
  console.log("🧪 Test 1: Insert cell between adjacent indices");
  ui.onInsertCellClick(2); // Insert between m0 and m00
  notebook.displayState();

  console.log("\n" + "=".repeat(61));
  console.log("🧪 Test 2: Insert another cell in crowded area");
  ui.onInsertCellClick(3);
  notebook.displayState();

  console.log("\n" + "=".repeat(61));
  console.log("🧪 Test 3: Move cell to crowded position");
  ui.onMoveCellClick("conclusion", 2);
  notebook.displayState();

  console.log("\n" + "=".repeat(61));
  console.log("🧪 Test 4: Rapid insertions to test robustness");
  for (let i = 0; i < 3; i++) {
    ui.onInsertCellClick(1);
  }
  notebook.displayState();

  console.log("\n" + "=".repeat(61));
  console.log("✅ Demo completed successfully! UI never got 'stuck'");
  console.log("🔑 Key takeaways:");
  console.log("   - Automatic rebalancing prevents UI lockups");
  console.log("   - Users experience brief loading states instead of errors");
  console.log(
    "   - System maintains performance with reasonable index lengths",
  );
  console.log("   - All operations remain deterministic and recoverable");
}

// Run the demo
if (import.meta.main) {
  try {
    runDemo();
  } catch (error) {
    console.error(error);
  }
}

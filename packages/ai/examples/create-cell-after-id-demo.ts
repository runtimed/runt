#!/usr/bin/env -S deno run --allow-all

/**
 * Demo: Creating cells with afterId parameter
 *
 * This demonstrates how the AI's create_cell tool can now place cells
 * after specific cell IDs, enabling precise notebook construction.
 */

import { NOTEBOOK_TOOLS_EXPORT } from "../tool-registry.ts";

console.log("=== Create Cell Tool with afterId Support ===\n");

// Find the create_cell tool
const createCellTool = NOTEBOOK_TOOLS_EXPORT.find((t) =>
  t.name === "create_cell"
);

if (!createCellTool) {
  console.error("create_cell tool not found!");
  Deno.exit(1);
}

// Display the tool definition
console.log("Tool Definition:");
console.log(JSON.stringify(createCellTool, null, 2));

console.log("\n=== Example Usage Scenarios ===\n");

// Scenario 1: Traditional positioning
console.log("1. Traditional positioning (relative to AI cell):");
console.log("   - position: 'after_current' - Places cell after the AI cell");
console.log("   - position: 'before_current' - Places cell before the AI cell");
console.log("   - position: 'at_end' - Places cell at the end of the notebook");

// Scenario 2: Using afterId
console.log("\n2. Using afterId for precise placement:");
console.log("   Step 1: Create initial cell");
console.log("   {");
console.log("     cellType: 'code',");
console.log("     source: 'import pandas as pd',");
console.log("     position: 'after_current'");
console.log("   }");
console.log("   Returns: 'Created code cell: cell-1234567890-abc'");
console.log("");
console.log("   Step 2: Create next cell after the first one");
console.log("   {");
console.log("     cellType: 'code',");
console.log("     source: 'df = pd.DataFrame({\"A\": [1, 2, 3]})',");
console.log(
  "     afterId: 'cell-1234567890-abc'  // <-- Using the ID from step 1",
);
console.log("   }");
console.log("   Returns: 'Created code cell: cell-1234567890-def'");
console.log("");
console.log("   Step 3: Continue building the sequence");
console.log("   {");
console.log("     cellType: 'code',");
console.log("     source: 'df.describe()',");
console.log(
  "     afterId: 'cell-1234567890-def'  // <-- Using the ID from step 2",
);
console.log("   }");

// Scenario 3: Complex notebook construction
console.log("\n3. Building a complex notebook structure:");
console.log("   The AI can now:");
console.log("   - Create a markdown header cell");
console.log("   - Add code cells in sequence after it");
console.log("   - Insert explanatory markdown between code cells");
console.log("   - Build up a complete analysis step by step");

console.log("\n=== Key Benefits ===\n");
console.log("✓ Precise control over cell ordering");
console.log("✓ Ability to build sequential workflows");
console.log("✓ Insert cells at any position by referencing existing cell IDs");
console.log("✓ Maintain logical flow in notebook construction");

console.log("\n=== Implementation Notes ===\n");
console.log("- afterId takes precedence over position when both are provided");
console.log("- If afterId references a non-existent cell, an error is thrown");
console.log(
  "- The AI receives the cell ID in the response for future reference",
);
console.log(
  "- This enables 'notebook mood' where AI builds cells sequentially",
);

// Show the actual parameters structure
console.log("\n=== Parameter Details ===\n");
const afterIdParam = createCellTool.parameters.properties.afterId;
console.log("afterId parameter:");
console.log(`  type: ${afterIdParam?.type}`);
console.log(`  description: ${afterIdParam?.description}`);
console.log(
  `  required: ${
    createCellTool.parameters.required?.includes("afterId") ? "yes" : "no"
  }`,
);

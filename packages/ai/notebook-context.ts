/**
 * Notebook context utilities for AI execution
 *
 * This module provides functions for gathering and processing notebook context
 * for AI execution, preserving conversation flow and tool call information.
 */

import type { Store } from "@runt/schema";
import {
  type CellData,
  type MediaContainer,
  type OutputData,
  tables,
} from "@runt/schema";
import type { CellContextData, NotebookContextData } from "./mod.ts";

/**
 * Gather notebook context for AI execution with proper conversation flow
 *
 * This function preserves the original output structure including metadata
 * that contains conversation roles and tool call information, unlike the
 * destructive string conversion in the runtime agent.
 */
export function gatherNotebookContext(
  store: Store,
  currentCell: { id: string; position: number },
): NotebookContextData {
  // Query all cells in order
  const allCells = store.query(
    tables.cells.select().orderBy("position", "asc"),
  );

  // Get cells before current cell that should be included in AI context
  const previousCells = allCells
    .filter((cell: CellData) =>
      cell.position < currentCell.position &&
      cell.aiContextVisible !== false
    )
    .map((cell: CellData): CellContextData => {
      // Query outputs for this cell in order
      const outputs = store.query(
        tables.outputs
          .select()
          .where({ cellId: cell.id })
          .orderBy("position", "asc"),
      );

      // Convert outputs to AI context format, preserving ALL metadata
      // This is crucial for maintaining conversation flow with tool calls
      const contextOutputs = outputs.map((output: OutputData) => {
        const result: {
          outputType: string;
          data: unknown;
          metadata?: Record<string, unknown>;
          representations?: Record<string, MediaContainer>;
        } = {
          outputType: output.outputType,
          data: output.data || {},
          metadata: output.metadata || {},
        };

        // Only include representations if they exist
        if (output.representations) {
          result.representations = output.representations;
        }

        return result;
      });

      return {
        id: cell.id,
        cellType: cell.cellType,
        source: cell.source || "",
        position: cell.position,
        outputs: contextOutputs,
      };
    });

  return {
    previousCells,
    totalCells: allCells.length,
    currentCellPosition: currentCell.position,
  };
}

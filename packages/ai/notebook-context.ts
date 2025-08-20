/**
 * Notebook context utilities for AI execution
 *
 * This module provides functions for gathering and processing notebook context
 * for AI execution, preserving conversation flow and tool call information.
 */

import type { Store } from "@livestore/livestore";
import { makeSchema, State } from "@livestore/livestore";
import {
  type CellData,
  type CellReference,
  events,
  materializers,
  type MediaContainer,
  type OutputData,
  tables,
} from "@runt/schema";

// Create schema locally
const state = State.SQLite.makeState({ tables, materializers });
const schema = makeSchema({ events, state });
import type { CellContextData, NotebookContextData } from "./mod.ts";

/**
 * Gather notebook context for AI execution with proper conversation flow
 *
 * This function preserves the original output structure including metadata
 * that contains conversation roles and tool call information, unlike the
 * destructive string conversion in the runtime agent.
 */
export function gatherNotebookContext(
  store: Store<typeof schema>,
  currentCell: CellReference,
): NotebookContextData {
  // Query all cells in order
  const allCells = store.query(
    tables.cells.select().orderBy("fractionalIndex", "asc"),
  );

  // Get cells before current cell that should be included in AI context
  const previousCells = allCells
    .filter((cell: CellData) => {
      // Skip cells that should not be visible in AI context
      if (cell.aiContextVisible === false) {
        return false;
      }

      // Use fractionalIndex comparison
      if (cell.fractionalIndex != null && currentCell.fractionalIndex != null) {
        return cell.fractionalIndex < currentCell.fractionalIndex;
      }

      // Skip cells without fractionalIndex
      return false;
    })
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
        fractionalIndex: cell.fractionalIndex || "",
        outputs: contextOutputs,
      };
    });

  return {
    previousCells,
    totalCells: allCells.length,
    currentCellFractionalIndex: currentCell.fractionalIndex || "",
  };
}

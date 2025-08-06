import React from "react";
import { useQuery } from "@livestore/react";
import { type OutputData, tables } from "@runt/schema";
import { queryDb } from "@livestore/livestore";

/**
 * TUI-specific query utilities for optimized SQLite operations
 * Follows patterns from Anode's query system for performance
 */

// Core cell queries optimized for TUI display
export const tuiCells$ = queryDb(
  tables.cells.select().orderBy("fractionalIndex", "asc"),
  { label: "tui.cells" },
);

export const tuiOutputDeltas$ = queryDb(
  tables.outputDeltas.select().orderBy("sequenceNumber", "asc"),
  { label: "tui.outputDeltas" },
);

export const tuiRuntimeSessions$ = queryDb(
  tables.runtimeSessions.select().orderBy("sessionId", "desc"),
  { label: "tui.runtimeSessions" },
);

export const tuiNotebookMetadata$ = queryDb(
  tables.notebookMetadata.select("key", "value"),
  { label: "tui.notebookMetadata" },
);

// Parameterized queries for individual cells
export const tuiCellQuery = {
  byId: (cellId: string) =>
    queryDb(
      tables.cells
        .select()
        .where({ id: cellId })
        .first({
          fallback: () => null,
        }),
      {
        deps: [cellId],
        label: `tui.cell.${cellId}`,
      },
    ),

  outputs: (cellId: string) =>
    queryDb(
      tables.outputs
        .select()
        .where({ cellId })
        .orderBy("position", "asc"),
      {
        deps: [cellId],
        label: `tui.outputs.${cellId}`,
      },
    ),

  // outputDeltas are accessed through outputs.outputId relationship
  // Direct cellId filtering not available on outputDeltas table

  executionQueue: (cellId: string) =>
    queryDb(
      tables.executionQueue
        .select()
        .where({ cellId })
        .orderBy("id", "desc"),
      {
        deps: [cellId],
        label: `tui.executionQueue.${cellId}`,
      },
    ),
};

// Optimized queries for bulk operations
export const tuiBulkQuery = {
  outputsByCells: (cellIds: string[]) =>
    queryDb(
      tables.outputs
        .select()
        .where({ cellId: { op: "IN", value: cellIds } })
        .orderBy("cellId", "asc")
        .orderBy("position", "asc"),
      {
        deps: cellIds,
        label: `tui.bulkOutputs.${cellIds.length}cells`,
      },
    ),
  // outputDeltasByCells not available - outputDeltas use outputId, not cellId
  // outputDeltas are processed through outputs relationship
};

// Utility queries for TUI-specific needs
export const tuiStatsQuery = {
  cellCount: () =>
    queryDb(
      tables.cells.select("id").count(),
      { label: "tui.stats.cellCount" },
    ),

  outputCount: () =>
    queryDb(
      tables.outputs.select("id").count(),
      { label: "tui.stats.outputCount" },
    ),

  activeSessions: () =>
    queryDb(
      tables.runtimeSessions
        .select()
        .where({ status: "ready" })
        .orderBy("sessionId", "desc"),
      { label: "tui.stats.activeSessions" },
    ),
};

// Custom hooks for optimized TUI data fetching
export const useTuiCellOutputs = (cellIds: string[]) => {
  const outputs = useQuery(
    cellIds.length > 0
      ? tuiBulkQuery.outputsByCells(cellIds)
      : queryDb(tables.outputs.select().where({ cellId: "never-matches" })),
  );

  return React.useMemo(() => {
    return outputs.reduce((acc, output) => {
      if (!acc[output.cellId]) {
        acc[output.cellId] = [];
      }
      acc[output.cellId].push(output);
      return acc;
    }, {} as Record<string, OutputData[]>);
  }, [outputs]);
};

// Hook for fetching outputs only for visible cells (performance optimization)
export const useTuiVisibleCellOutputs = (visibleCellIds: string[]) => {
  return useTuiCellOutputs(visibleCellIds);
};

// Advanced hook for viewport-aware output fetching
export const useTuiViewportOutputs = (
  allCells: { id: string; position: number }[],
  selectedIndex: number,
  maxHeight: number,
  itemHeights: number[],
) => {
  // Calculate visible cell range based on scroll position
  const visibleCellIds = React.useMemo(() => {
    if (allCells.length === 0) return [];

    // Simple viewport calculation - expand around selected cell
    const safeSelectedIndex = Math.max(
      0,
      Math.min(selectedIndex, allCells.length - 1),
    );
    let startIdx = safeSelectedIndex;
    let endIdx = safeSelectedIndex;
    let currentHeight = itemHeights[safeSelectedIndex] || 1;

    // Expand downward
    while (endIdx + 1 < allCells.length) {
      const nextHeight = itemHeights[endIdx + 1] || 1;
      if (currentHeight + nextHeight > maxHeight) break;
      endIdx++;
      currentHeight += nextHeight;
    }

    // Expand upward
    while (startIdx > 0) {
      const prevHeight = itemHeights[startIdx - 1] || 1;
      if (currentHeight + prevHeight > maxHeight) break;
      startIdx--;
      currentHeight += prevHeight;
    }

    // Add buffer cells above/below for smooth scrolling
    const bufferSize = 2;
    const bufferedStart = Math.max(0, startIdx - bufferSize);
    const bufferedEnd = Math.min(allCells.length - 1, endIdx + bufferSize);

    return allCells.slice(bufferedStart, bufferedEnd + 1).map((cell) =>
      cell.id
    );
  }, [allCells, selectedIndex, maxHeight, itemHeights]);

  return useTuiCellOutputs(visibleCellIds);
};

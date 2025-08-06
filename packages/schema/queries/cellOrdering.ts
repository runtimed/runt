import { tables } from "../tables.ts";
import { queryDb } from "@livestore/livestore";

/**
 * Cell ordering queries using fractional indexing
 * These queries are designed to be fine-grained and reusable
 * to minimize re-renders across the application
 */

// Get all cells with their fractional indices, sorted
export const cellsWithIndices$ = queryDb(
  tables.cells
    .select("id", "fractionalIndex", "cellType")
    .orderBy("fractionalIndex", "asc"),
  { label: "cells.withIndices" },
);

// Get just the cell ordering information (minimal fields)
export const cellOrdering$ = queryDb(
  tables.cells
    .select("id", "fractionalIndex")
    .orderBy("fractionalIndex", "asc"),
  { label: "cells.ordering" },
);

// Get the first cell in the notebook
export const firstCell$ = queryDb(
  tables.cells
    .select("id", "fractionalIndex")
    .orderBy("fractionalIndex", "asc")
    .first({ fallback: () => null }),
  { label: "cells.first" },
);

// Get the last cell in the notebook
export const lastCell$ = queryDb(
  tables.cells
    .select("id", "fractionalIndex")
    .orderBy("fractionalIndex", "desc")
    .first({ fallback: () => null }),
  { label: "cells.last" },
);

// Get cells before a specific fractional index
export const cellsBefore = (fractionalIndex: string, limit: number = 1) =>
  queryDb(
    tables.cells
      .select("id", "fractionalIndex")
      .where("fractionalIndex", "<", fractionalIndex)
      .orderBy("fractionalIndex", "desc")
      .limit(limit),
    {
      deps: [fractionalIndex, limit],
      label: `cells.before.${fractionalIndex}`,
    },
  );

// Get cells after a specific fractional index
export const cellsAfter = (fractionalIndex: string, limit: number = 1) =>
  queryDb(
    tables.cells
      .select("id", "fractionalIndex")
      .where("fractionalIndex", ">", fractionalIndex)
      .orderBy("fractionalIndex", "asc")
      .limit(limit),
    {
      deps: [fractionalIndex, limit],
      label: `cells.after.${fractionalIndex}`,
    },
  );

// Get neighboring cells (one before and one after)
export const neighboringCells = (cellId: string) =>
  queryDb(
    tables.cells
      .select("id", "fractionalIndex")
      .orderBy("fractionalIndex", "asc"),
    {
      deps: [cellId],
      label: `cells.neighbors.${cellId}`,
    },
  );

// Get the immediate adjacent cells (previous and next) for a specific cell
export const getAdjacentCells = (cellId: string, fractionalIndex: string) => {
  const previousCell$ = queryDb(
    tables.cells
      .select("id", "fractionalIndex")
      .where("fractionalIndex", "<", fractionalIndex)
      .orderBy("fractionalIndex", "desc")
      .first({ fallback: () => null }),
    {
      deps: [cellId, fractionalIndex],
      label: `cells.previous.${cellId}`,
    },
  );

  const nextCell$ = queryDb(
    tables.cells
      .select("id", "fractionalIndex")
      .where("fractionalIndex", ">", fractionalIndex)
      .orderBy("fractionalIndex", "asc")
      .first({ fallback: () => null }),
    {
      deps: [cellId, fractionalIndex],
      label: `cells.next.${cellId}`,
    },
  );

  return { previousCell$, nextCell$ };
};

// Get cell position info (useful for UI that needs to know if a cell is first/last)
export const cellPositionInfo = (cellId: string) =>
  queryDb(
    tables.cells
      .select("id", "fractionalIndex")
      .where({ id: cellId })
      .first({ fallback: () => null }),
    {
      deps: [cellId],
      label: `cells.positionInfo.${cellId}`,
    },
  );

// Get cells in a range (useful for virtualization)
export const cellsInRange = (
  startIndex: string | null,
  endIndex: string | null,
) => {
  let query = tables.cells.select("id", "fractionalIndex", "cellType");

  if (startIndex && endIndex) {
    // Both bounds specified
    query = query
      .where("fractionalIndex", ">=", startIndex)
      .where("fractionalIndex", "<=", endIndex);
  } else if (startIndex) {
    // Only start bound
    query = query.where("fractionalIndex", ">=", startIndex);
  } else if (endIndex) {
    // Only end bound
    query = query.where("fractionalIndex", "<=", endIndex);
  }

  return queryDb(query.orderBy("fractionalIndex", "asc"), {
    deps: [startIndex, endIndex],
    label: `cells.range.${startIndex}-${endIndex}`,
  });
};

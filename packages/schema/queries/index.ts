import { tables } from "../tables.ts";
import { queryDb } from "@livestore/livestore";

export * from "./outputDeltas.ts";
export * from "./cellOrdering.ts";

export const cellIDs$ = queryDb(
  tables.cells.select("id").orderBy("fractionalIndex", "asc"),
  { label: "notebook.cellIds" },
);

// Primary query for cell references - returns CellReference objects
export const cellReferences$ = queryDb(
  tables.cells
    .select("id", "fractionalIndex", "cellType")
    .orderBy("fractionalIndex", "asc"),
  { label: "notebook.cellReferences" },
);

// @deprecated Use cellReferences$ instead
export const cellList$ = cellReferences$;

// Query for getting a specific cell's fractional index
export const cellFractionalIndex = (cellId: string) =>
  queryDb(
    tables.cells
      .select("fractionalIndex")
      .where({ id: cellId })
      .first({
        fallback: () => null,
      }),
    {
      deps: [cellId],
      label: `cell.fractionalIndex.${cellId}`,
    },
  );

// @deprecated Use cellReferences$ instead - this returns all cells anyway
export const adjacentCells = (_cellId: string) => cellReferences$;

export const notebookMetadata$ = queryDb(
  tables.notebookMetadata.select("key", "value"),
);

export const cellQuery = {
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
        label: `cell.${cellId}`,
      },
    ),

  outputs: (cellId: string) =>
    queryDb(
      tables.outputs.select().where({ cellId }).orderBy("position", "asc"),
      { deps: [cellId], label: `outputs:${cellId}` },
    ),

  executionQueue: (cellId: string) =>
    queryDb(
      tables.executionQueue.select().where({ cellId }).orderBy("id", "desc"),
      { deps: [cellId], label: `queue:${cellId}` },
    ),
};

export const runtimeSessions$ = queryDb(
  tables.runtimeSessions.select().orderBy("sessionId", "desc"),
  { label: "runtime.sessions" },
);

/**
 * Full cells query - returns complete cell data including source, metadata, etc.
 *
 * ⚠️  PERFORMANCE WARNING: This loads ALL cell data at once.
 *
 * Use this only when you need:
 * - Full cell properties (source, executionCount, metadata, etc.)
 * - Operations that require all cells (like TUI navigation)
 *
 * For most use cases, prefer:
 * - `cellReferences$` for cell ordering/navigation with minimal data
 * - `cellQuery.byId(cellId)` for individual cell data
 */
export const cells$ = queryDb(
  tables.cells.select().orderBy("fractionalIndex", "asc"),
  { label: "notebook.cells" },
);

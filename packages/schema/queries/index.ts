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

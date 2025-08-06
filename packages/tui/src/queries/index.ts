/**
 * TUI query utilities - using shared queries from @runt/schema
 * Individual cells should manage their own outputs using cellQuery.outputs(cellId)
 */

// Re-export shared queries from schema package
export {
  cellQuery,
  cellReferences$,
  cells$,
  notebookMetadata$,
  outputDeltas$,
  runtimeSessions$,
} from "@runt/schema";

// Legacy aliases for backward compatibility
export {
  cellQuery as tuiCellQuery,
  cells$ as tuiCells$,
  notebookMetadata$ as tuiNotebookMetadata$,
  outputDeltas$ as tuiOutputDeltas$,
  runtimeSessions$ as tuiRuntimeSessions$,
} from "@runt/schema";

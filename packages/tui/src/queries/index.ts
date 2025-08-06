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
  runtimeSessions$,
} from "@runt/schema";

export { outputDeltas$ } from "@runt/schema/queries";

// Legacy aliases for backward compatibility
export {
  cellQuery as tuiCellQuery,
  cells$ as tuiCells$,
  notebookMetadata$ as tuiNotebookMetadata$,
  runtimeSessions$ as tuiRuntimeSessions$,
} from "@runt/schema";

export { outputDeltas$ as tuiOutputDeltas$ } from "@runt/schema/queries";

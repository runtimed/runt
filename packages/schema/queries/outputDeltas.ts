import { tables } from "../tables.ts";
import { queryDb } from "@livestore/livestore";

interface OutputDelta {
  id: string;
  outputId: string;
  delta: string;
  sequenceNumber: number;
}

/**
 * Query deltas for a given output ID, sorted by sequence number
 */
export const outputDeltasQuery = (outputId: string) =>
  queryDb(
    tables.outputDeltas
      .select()
      .where({ outputId })
      .orderBy("sequenceNumber", "asc"),
    { deps: [outputId], label: "outputDeltas" },
  );

/**
 * Apply deltas to original content in sequence order
 */
export const applyDeltas = (
  originalContent: string,
  deltas: readonly OutputDelta[],
): string => {
  if (deltas.length === 0) {
    return originalContent;
  }

  return deltas.reduce((acc, delta) => {
    return acc + delta.delta;
  }, originalContent);
};

/**
 * Get final content with deltas applied
 */
export const getFinalContent = (
  originalContent: string,
  deltas: readonly OutputDelta[],
): { content: string; hasDeltas: boolean; deltaCount: number } => {
  const hasDeltas = deltas.length > 0;
  const content = applyDeltas(originalContent, deltas);

  return {
    content,
    hasDeltas,
    deltaCount: deltas.length,
  };
};

/**
 * Query all output deltas, sorted by sequence number
 */
export const outputDeltas$ = queryDb(
  tables.outputDeltas.select().orderBy("sequenceNumber", "asc"),
  { label: "notebook.outputDeltas" },
);

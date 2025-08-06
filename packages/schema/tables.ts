import { Schema, SessionIdSymbol, State } from "@livestore/livestore";

import {
  CellTypeSchema,
  ExecutionStateSchema,
  MediaRepresentationSchema,
  OutputTypeSchema,
  QueueStatusSchema,
  RuntimeStatusSchema,
} from "./types.ts";

export const tables = {
  debug: State.SQLite.table({
    name: "debug",
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      // Update column name or value to test schema changes
      version: State.SQLite.text({ default: "1" }),
    },
  }),

  presence: State.SQLite.table({
    name: "presence",
    columns: {
      userId: State.SQLite.text({ primaryKey: true }),
      cellId: State.SQLite.text({ nullable: true }),
    },
  }),

  // Notebook metadata (key-value pairs per store)
  notebookMetadata: State.SQLite.table({
    name: "notebookMetadata",
    columns: {
      key: State.SQLite.text({ primaryKey: true }),
      value: State.SQLite.text(),
    },
  }),

  cells: State.SQLite.table({
    name: "cells",
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      cellType: State.SQLite.text({
        schema: CellTypeSchema,
      }),
      source: State.SQLite.text({ default: "" }),
      fractionalIndex: State.SQLite.text({ nullable: true }), // Fractional index for deterministic ordering

      // Execution state
      executionCount: State.SQLite.integer({ nullable: true }),
      executionState: State.SQLite.text({
        default: "idle",
        schema: ExecutionStateSchema,
      }),
      assignedRuntimeSession: State.SQLite.text({ nullable: true }), // Which runtime session is handling this
      lastExecutionDurationMs: State.SQLite.integer({ nullable: true }), // Duration of last execution in milliseconds

      // SQL-specific fields
      sqlConnectionId: State.SQLite.text({ nullable: true }),
      sqlResultVariable: State.SQLite.text({ nullable: true }),

      // AI-specific fields
      aiProvider: State.SQLite.text({ nullable: true }), // 'openai', 'anthropic', 'local'
      aiModel: State.SQLite.text({ nullable: true }),
      aiSettings: State.SQLite.json({ nullable: true, schema: Schema.Any }), // temperature, max_tokens, etc.

      // Display visibility controls
      sourceVisible: State.SQLite.boolean({ default: true }),
      outputVisible: State.SQLite.boolean({ default: true }),
      aiContextVisible: State.SQLite.boolean({ default: true }),

      createdBy: State.SQLite.text(),
    },
  }),

  outputDeltas: State.SQLite.table({
    name: "output_deltas",
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      outputId: State.SQLite.text(),
      delta: State.SQLite.text({ default: "" }),
      sequenceNumber: State.SQLite.integer(),
    },
  }),

  outputs: State.SQLite.table({
    name: "outputs",
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      cellId: State.SQLite.text(),
      outputType: State.SQLite.text({
        schema: OutputTypeSchema,
      }),
      position: State.SQLite.real(),

      // Type-specific fields
      streamName: State.SQLite.text({ nullable: true }), // 'stdout', 'stderr' for terminal outputs
      executionCount: State.SQLite.integer({ nullable: true }), // Only for multimedia_result
      displayId: State.SQLite.text({ nullable: true }), // Only for multimedia_display

      // Flattened content for SQL operations
      data: State.SQLite.text({ nullable: true }), // Primary/concatenated content (text)
      artifactId: State.SQLite.text({ nullable: true }), // Primary artifact reference
      mimeType: State.SQLite.text({ nullable: true }), // Primary mime type
      metadata: State.SQLite.json({ nullable: true, schema: Schema.Any }), // Primary metadata

      // Multi-media support
      representations: State.SQLite.json({
        nullable: true,
        schema: Schema.Record({
          key: Schema.String,
          value: MediaRepresentationSchema,
        }),
      }),
    },
  }),

  // Pending clears table for clear_output(wait=True) support
  pendingClears: State.SQLite.table({
    name: "pendingClears",
    columns: {
      cellId: State.SQLite.text({ primaryKey: true }),
      clearedBy: State.SQLite.text(),
    },
  }),

  // Runtime lifecycle management
  // NOTE: Each notebook should have exactly ONE active runtime at a time
  // Multiple entries only exist during runtime transitions/handoffs
  runtimeSessions: State.SQLite.table({
    name: "runtimeSessions",
    columns: {
      sessionId: State.SQLite.text({ primaryKey: true }),
      runtimeId: State.SQLite.text(), // Stable runtime identifier
      runtimeType: State.SQLite.text({ default: "python3" }),
      status: State.SQLite.text({
        schema: RuntimeStatusSchema,
      }),
      isActive: State.SQLite.boolean({ default: true }),

      // Capability flags
      canExecuteCode: State.SQLite.boolean({ default: false }),
      canExecuteSql: State.SQLite.boolean({ default: false }),
      canExecuteAi: State.SQLite.boolean({ default: false }),
      availableAiModels: State.SQLite.json({
        nullable: true,
        schema: Schema.Any,
      }),
    },
  }),

  // Execution queue - tracks work that needs to be done
  executionQueue: State.SQLite.table({
    name: "executionQueue",
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      cellId: State.SQLite.text(),
      executionCount: State.SQLite.integer(),
      requestedBy: State.SQLite.text(),

      // Queue management
      status: State.SQLite.text({
        default: "pending",
        schema: QueueStatusSchema,
      }),
      assignedRuntimeSession: State.SQLite.text({ nullable: true }),

      // Execution timing
      startedAt: State.SQLite.datetime({ nullable: true }),
      completedAt: State.SQLite.datetime({ nullable: true }),
      executionDurationMs: State.SQLite.integer({ nullable: true }),
    },
  }),

  // UI state for each user
  uiState: State.SQLite.clientDocument({
    name: "uiState",
    schema: Schema.Struct({
      selectedCellId: Schema.optional(Schema.String),
      editingCellId: Schema.optional(Schema.String),
      runtimeStatus: Schema.optional(Schema.String),
    }),
    default: {
      id: SessionIdSymbol,
      value: {},
    },
  }),

  // Actors table for tracking who/what performs actions
  actors: State.SQLite.table({
    name: "actors",
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      type: State.SQLite.text(), // "human" | "runtime_agent"
      displayName: State.SQLite.text(),
      avatar: State.SQLite.text({ nullable: true }),
    },
  }),

  // Tool approvals for AI tool calls
  toolApprovals: State.SQLite.table({
    name: "toolApprovals",
    columns: {
      toolCallId: State.SQLite.text({ primaryKey: true }),
      cellId: State.SQLite.text(),
      toolName: State.SQLite.text(),
      status: State.SQLite.text({
        schema: Schema.Literal(
          "pending",
          "approved_once",
          "approved_always",
          "denied",
        ),
      }),
      approvedBy: State.SQLite.text({ nullable: true }),
      requestedAt: State.SQLite.datetime(),
      respondedAt: State.SQLite.datetime({ nullable: true }),
    },
  }),
};

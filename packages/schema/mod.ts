import {
  Events,
  makeSchema,
  Schema,
  SessionIdSymbol,
  State,
  type Store as LiveStore,
} from "@livestore/livestore";

// Media representation schema for unified output system - defined first for use in events
const MediaRepresentationSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("inline"),
    data: Schema.Any,
    metadata: Schema.optional(
      Schema.Record({ key: Schema.String, value: Schema.Any }),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("artifact"),
    artifactId: Schema.String,
    metadata: Schema.optional(
      Schema.Record({ key: Schema.String, value: Schema.Any }),
    ),
  }),
);

export const tables = {
  // Notebook metadata (single row per store)
  notebook: State.SQLite.table({
    name: "notebook",
    columns: {
      id: State.SQLite.text({ primaryKey: true }), // Same as storeId
      title: State.SQLite.text({ default: "Untitled Notebook" }),
      runtimeType: State.SQLite.text({ default: "python3" }),
      ownerId: State.SQLite.text(),
      isPublic: State.SQLite.boolean({ default: false }),
    },
  }),

  cells: State.SQLite.table({
    name: "cells",
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      cellType: State.SQLite.text({
        schema: Schema.Literal("code", "markdown", "raw", "sql", "ai"),
      }),
      source: State.SQLite.text({ default: "" }),
      position: State.SQLite.real(),

      // Execution state
      executionCount: State.SQLite.integer({ nullable: true }),
      executionState: State.SQLite.text({
        default: "idle",
        schema: Schema.Literal(
          "idle",
          "queued",
          "running",
          "completed",
          "error",
        ),
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

  outputs: State.SQLite.table({
    name: "outputs",
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      cellId: State.SQLite.text(),
      outputType: State.SQLite.text({
        schema: Schema.Literal(
          "multimedia_display",
          "multimedia_result",
          "terminal",
          "markdown",
          "error",
        ),
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
        schema: Schema.Any,
      }), // Full representation map for multimedia outputs
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
        schema: Schema.Literal(
          "starting",
          "ready",
          "busy",
          "restarting",
          "terminated",
        ),
      }),
      isActive: State.SQLite.boolean({ default: true }),

      // Capability flags
      canExecuteCode: State.SQLite.boolean({ default: false }),
      canExecuteSql: State.SQLite.boolean({ default: false }),
      canExecuteAi: State.SQLite.boolean({ default: false }),
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
        schema: Schema.Literal(
          "pending",
          "assigned",
          "executing",
          "completed",
          "failed",
          "cancelled",
        ),
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
};

// Events describe notebook and cell changes
// All events are scoped to a single notebook (storeId = notebookId)
export const events = {
  // Notebook events (single notebook per store)
  notebookInitialized: Events.synced({
    name: "v1.NotebookInitialized",
    schema: Schema.Struct({
      id: Schema.String, // Same as storeId
      title: Schema.String,
      ownerId: Schema.String,
    }),
  }),

  notebookTitleChanged: Events.synced({
    name: "v1.NotebookTitleChanged",
    schema: Schema.Struct({
      title: Schema.String,
    }),
  }),

  // Cell events
  cellCreated: Events.synced({
    name: "v1.CellCreated",
    schema: Schema.Struct({
      id: Schema.String,
      cellType: Schema.Literal("code", "markdown", "raw", "sql", "ai"),
      position: Schema.Number,
      createdBy: Schema.String,
    }),
  }),

  cellSourceChanged: Events.synced({
    name: "v1.CellSourceChanged",
    schema: Schema.Struct({
      id: Schema.String,
      source: Schema.String,
      modifiedBy: Schema.String,
    }),
  }),

  cellTypeChanged: Events.synced({
    name: "v1.CellTypeChanged",
    schema: Schema.Struct({
      id: Schema.String,
      cellType: Schema.Literal("code", "markdown", "raw", "sql", "ai"),
    }),
  }),

  cellDeleted: Events.synced({
    name: "v1.CellDeleted",
    schema: Schema.Struct({
      id: Schema.String,
    }),
  }),

  cellMoved: Events.synced({
    name: "v1.CellMoved",
    schema: Schema.Struct({
      id: Schema.String,
      newPosition: Schema.Number,
    }),
  }),

  cellSourceVisibilityToggled: Events.synced({
    name: "v1.CellSourceVisibilityToggled",
    schema: Schema.Struct({
      id: Schema.String,
      sourceVisible: Schema.Boolean,
    }),
  }),

  cellOutputVisibilityToggled: Events.synced({
    name: "v1.CellOutputVisibilityToggled",
    schema: Schema.Struct({
      id: Schema.String,
      outputVisible: Schema.Boolean,
    }),
  }),

  cellAiContextVisibilityToggled: Events.synced({
    name: "v1.CellAiContextVisibilityToggled",
    schema: Schema.Struct({
      id: Schema.String,
      aiContextVisible: Schema.Boolean,
    }),
  }),

  // Runtime lifecycle events
  runtimeSessionStarted: Events.synced({
    name: "v1.RuntimeSessionStarted",
    schema: Schema.Struct({
      sessionId: Schema.String, // Unique per runtime restart
      runtimeId: Schema.String, // Stable runtime identifier
      runtimeType: Schema.String,
      capabilities: Schema.Struct({
        canExecuteCode: Schema.Boolean,
        canExecuteSql: Schema.Boolean,
        canExecuteAi: Schema.Boolean,
      }),
    }),
  }),

  runtimeSessionStatusChanged: Events.synced({
    name: "v1.RuntimeSessionStatusChanged",
    schema: Schema.Struct({
      sessionId: Schema.String,
      status: Schema.Literal("ready", "busy", "restarting"),
    }),
  }),

  runtimeSessionTerminated: Events.synced({
    name: "v1.RuntimeSessionTerminated",
    schema: Schema.Struct({
      sessionId: Schema.String,
      reason: Schema.Literal(
        "shutdown",
        "restart",
        "error",
        "timeout",
        "displaced",
      ),
    }),
  }),

  // Execution queue events
  executionRequested: Events.synced({
    name: "v1.ExecutionRequested",
    schema: Schema.Struct({
      queueId: Schema.String,
      cellId: Schema.String,
      executionCount: Schema.Number,
      requestedBy: Schema.String,
    }),
  }),

  executionAssigned: Events.synced({
    name: "v1.ExecutionAssigned",
    schema: Schema.Struct({
      queueId: Schema.String,
      runtimeSessionId: Schema.String,
    }),
  }),

  executionStarted: Events.synced({
    name: "v1.ExecutionStarted",
    schema: Schema.Struct({
      queueId: Schema.String,
      cellId: Schema.String,
      runtimeSessionId: Schema.String,
      startedAt: Schema.Date,
    }),
  }),

  executionCompleted: Events.synced({
    name: "v1.ExecutionCompleted",
    schema: Schema.Struct({
      queueId: Schema.String,
      cellId: Schema.String,
      status: Schema.Literal("success", "error", "cancelled"),
      error: Schema.optional(Schema.String),
      completedAt: Schema.Date,
      executionDurationMs: Schema.Number,
    }),
  }),

  executionCancelled: Events.synced({
    name: "v1.ExecutionCancelled",
    schema: Schema.Struct({
      queueId: Schema.String,
      cellId: Schema.String,
      cancelledBy: Schema.String,
      reason: Schema.String,
    }),
  }),

  // Unified output system - granular events replacing cellOutputAdded
  multimediaDisplayOutputAdded: Events.synced({
    name: "v1.MultimediaDisplayOutputAdded",
    schema: Schema.Struct({
      id: Schema.String,
      cellId: Schema.String,
      position: Schema.Number,
      representations: Schema.Record({
        key: Schema.String,
        value: MediaRepresentationSchema,
      }),
      displayId: Schema.optional(Schema.String),
    }),
  }),

  multimediaResultOutputAdded: Events.synced({
    name: "v1.MultimediaResultOutputAdded",
    schema: Schema.Struct({
      id: Schema.String,
      cellId: Schema.String,
      position: Schema.Number,
      representations: Schema.Record({
        key: Schema.String,
        value: MediaRepresentationSchema,
      }),
      executionCount: Schema.Number,
    }),
  }),

  terminalOutputAdded: Events.synced({
    name: "v1.TerminalOutputAdded",
    schema: Schema.Struct({
      id: Schema.String,
      cellId: Schema.String,
      position: Schema.Number,
      content: MediaRepresentationSchema,
      streamName: Schema.Literal("stdout", "stderr"),
    }),
  }),

  terminalOutputAppended: Events.synced({
    name: "v1.TerminalOutputAppended",
    schema: Schema.Struct({
      outputId: Schema.String,
      content: MediaRepresentationSchema,
    }),
  }),

  markdownOutputAdded: Events.synced({
    name: "v1.MarkdownOutputAdded",
    schema: Schema.Struct({
      id: Schema.String,
      cellId: Schema.String,
      position: Schema.Number,
      content: MediaRepresentationSchema,
    }),
  }),

  markdownOutputAppended: Events.synced({
    name: "v1.MarkdownOutputAppended",
    schema: Schema.Struct({
      outputId: Schema.String,
      content: MediaRepresentationSchema,
    }),
  }),

  errorOutputAdded: Events.synced({
    name: "v1.ErrorOutputAdded",
    schema: Schema.Struct({
      id: Schema.String,
      cellId: Schema.String,
      position: Schema.Number,
      content: MediaRepresentationSchema,
    }),
  }),

  cellOutputsCleared: Events.synced({
    name: "v1.CellOutputsCleared",
    schema: Schema.Struct({
      cellId: Schema.String,
      wait: Schema.Boolean,
      clearedBy: Schema.String,
    }),
  }),

  // AI events
  aiSettingsChanged: Events.synced({
    name: "v1.AiSettingsChanged",
    schema: Schema.Struct({
      cellId: Schema.String,
      provider: Schema.String, // 'openai', 'anthropic', 'local'
      model: Schema.String,
      settings: Schema.Struct({
        temperature: Schema.optional(Schema.Number),
        maxTokens: Schema.optional(Schema.Number),
        systemPrompt: Schema.optional(Schema.String),
      }),
    }),
  }),

  // SQL events
  sqlConnectionChanged: Events.synced({
    name: "v1.SqlConnectionChanged",
    schema: Schema.Struct({
      cellId: Schema.String,
      connectionId: Schema.optional(Schema.String),
      changedBy: Schema.String,
    }),
  }),

  sqlResultVariableChanged: Events.synced({
    name: "v1.SqlResultVariableChanged",
    schema: Schema.Struct({
      cellId: Schema.String,
      resultVariable: Schema.optional(Schema.String),
      changedBy: Schema.String,
    }),
  }),

  // UI state
  uiStateSet: tables.uiState.set,
};

// Materializers map events to state changes
const materializers = State.SQLite.materializers(events, {
  // Notebook materializers
  "v1.NotebookInitialized": ({ id, title, ownerId }) =>
    tables.notebook.insert({
      id,
      title,
      ownerId,
    }),

  "v1.NotebookTitleChanged": ({ title }) => tables.notebook.update({ title }),

  // Cell materializers
  "v1.CellCreated": ({ id, cellType, position, createdBy }) =>
    tables.cells.insert({
      id,
      cellType,
      position,
      createdBy,
    }),

  "v1.CellSourceChanged": ({ id, source }) =>
    tables.cells.update({ source }).where({ id }),

  "v1.CellTypeChanged": ({ id, cellType }) =>
    tables.cells.update({ cellType }).where({ id }),

  "v1.CellDeleted": ({ id }) => tables.cells.delete().where({ id }),

  "v1.CellMoved": ({ id, newPosition }) =>
    tables.cells.update({ position: newPosition }).where({ id }),

  "v1.CellSourceVisibilityToggled": ({ id, sourceVisible }) =>
    tables.cells.update({ sourceVisible }).where({ id }),

  "v1.CellOutputVisibilityToggled": ({ id, outputVisible }) =>
    tables.cells.update({ outputVisible }).where({ id }),

  "v1.CellAiContextVisibilityToggled": ({ id, aiContextVisible }) =>
    tables.cells.update({ aiContextVisible }).where({ id }),

  // Runtime lifecycle materializers
  "v1.RuntimeSessionStarted": ({
    sessionId,
    runtimeId,
    runtimeType,
    capabilities,
  }) =>
    tables.runtimeSessions.insert({
      sessionId,
      runtimeId,
      runtimeType,
      status: "starting",
      canExecuteCode: capabilities.canExecuteCode,
      canExecuteSql: capabilities.canExecuteSql,
      canExecuteAi: capabilities.canExecuteAi,
    }),

  "v1.RuntimeSessionStatusChanged": ({ sessionId, status }) =>
    tables.runtimeSessions
      .update({
        status,
      })
      .where({ sessionId }),

  "v1.RuntimeSessionTerminated": ({ sessionId }) =>
    tables.runtimeSessions
      .update({
        status: "terminated",
        isActive: false,
      })
      .where({ sessionId }),

  // Execution queue materializers
  "v1.ExecutionRequested": ({
    queueId,
    cellId,
    executionCount,
    requestedBy,
  }) => [
    tables.executionQueue.insert({
      id: queueId,
      cellId,
      executionCount,
      requestedBy,
      status: "pending",
    }),
    // Update cell execution state
    tables.cells
      .update({
        executionState: "queued",
        executionCount,
      })
      .where({ id: cellId }),
  ],

  "v1.ExecutionAssigned": ({ queueId, runtimeSessionId }) =>
    tables.executionQueue
      .update({
        status: "assigned",
        assignedRuntimeSession: runtimeSessionId,
      })
      .where({ id: queueId }),

  "v1.ExecutionStarted": ({ queueId, cellId, runtimeSessionId, startedAt }) => [
    // Update execution queue
    tables.executionQueue
      .update({
        status: "executing",
        startedAt: startedAt,
      })
      .where({ id: queueId }),
    // Update cell execution state
    tables.cells
      .update({
        executionState: "running",
        assignedRuntimeSession: runtimeSessionId,
      })
      .where({ id: cellId }),
  ],

  "v1.ExecutionCompleted": ({
    queueId,
    cellId,
    status,
    completedAt,
    executionDurationMs,
  }) => [
    // Update execution queue
    tables.executionQueue
      .update({
        status: status === "success" ? "completed" : "failed",
        completedAt: completedAt,
        executionDurationMs: executionDurationMs,
      })
      .where({ id: queueId }),
    // Update cell execution state
    tables.cells
      .update({
        executionState: status === "success" ? "completed" : "error",
        lastExecutionDurationMs: executionDurationMs,
      })
      .where({ id: cellId }),
  ],

  "v1.ExecutionCancelled": ({ queueId, cellId }) => [
    // Update execution queue
    tables.executionQueue
      .update({
        status: "cancelled",
      })
      .where({ id: queueId }),
    // Update cell execution state
    tables.cells
      .update({
        executionState: "idle",
      })
      .where({ id: cellId }),
  ],

  // Unified output system materializers with pending clear support
  "v1.MultimediaDisplayOutputAdded": (
    { id, cellId, position, representations, displayId },
    ctx,
  ) => {
    const ops = [];
    // Check for pending clears
    const pendingClear = ctx.query(
      tables.pendingClears.select().where({ cellId }).limit(1),
    )[0];
    if (pendingClear) {
      ops.push(tables.outputs.delete().where({ cellId }));
      ops.push(tables.pendingClears.delete().where({ cellId }));
    }

    // Choose primary representation
    const preferenceOrder = [
      "text/html",
      "image/png",
      "image/jpeg",
      "image/svg+xml",
      "application/json",
      "text/plain",
    ];
    let primaryData = "";
    let primaryMimeType = "text/plain";

    for (const mimeType of preferenceOrder) {
      if (representations[mimeType]) {
        const rep = representations[mimeType];
        primaryData = rep.type === "inline" ? String(rep.data || "") : "";
        primaryMimeType = mimeType;
        break;
      }
    }

    ops.push(
      tables.outputs.insert({
        id,
        cellId,
        outputType: "multimedia_display",
        position,
        displayId: displayId || null,
        data: primaryData,
        artifactId: null,
        mimeType: primaryMimeType,
        metadata: null,
        representations,
      }),
    );
    return ops;
  },

  "v1.MultimediaResultOutputAdded": (
    { id, cellId, position, representations, executionCount },
    ctx,
  ) => {
    const ops = [];
    // Check for pending clears
    const pendingClear = ctx.query(
      tables.pendingClears.select().where({ cellId }).limit(1),
    )[0];
    if (pendingClear) {
      ops.push(tables.outputs.delete().where({ cellId }));
      ops.push(tables.pendingClears.delete().where({ cellId }));
    }

    // Choose primary representation
    const preferenceOrder = [
      "text/html",
      "image/png",
      "image/jpeg",
      "image/svg+xml",
      "application/json",
      "text/plain",
    ];
    let primaryData = "";
    let primaryMimeType = "text/plain";

    for (const mimeType of preferenceOrder) {
      if (representations[mimeType]) {
        const rep = representations[mimeType];
        primaryData = rep.type === "inline" ? String(rep.data || "") : "";
        primaryMimeType = mimeType;
        break;
      }
    }

    ops.push(
      tables.outputs.insert({
        id,
        cellId,
        outputType: "multimedia_result",
        position,
        executionCount,
        data: primaryData,
        artifactId: null,
        mimeType: primaryMimeType,
        metadata: null,
        representations,
      }),
    );
    return ops;
  },

  "v1.TerminalOutputAdded": (
    { id, cellId, position, content, streamName },
    ctx,
  ) => {
    const ops = [];
    // Check for pending clears
    const pendingClear = ctx.query(
      tables.pendingClears.select().where({ cellId }).limit(1),
    )[0];
    if (pendingClear) {
      ops.push(tables.outputs.delete().where({ cellId }));
      ops.push(tables.pendingClears.delete().where({ cellId }));
    }

    ops.push(
      tables.outputs.insert({
        id,
        cellId,
        outputType: "terminal",
        position,
        streamName,
        data: content.type === "inline" ? String(content.data) : null,
        artifactId: content.type === "artifact" ? content.artifactId : null,
        mimeType: "text/plain",
        metadata: content.metadata || null,
        representations: null,
      }),
    );
    return ops;
  },

  "v1.TerminalOutputAppended": ({ outputId, content }, ctx) => {
    const existingOutput = ctx.query(
      tables.outputs.select().where({ id: outputId }).limit(1),
    )[0];

    if (!existingOutput) {
      return [];
    }

    const newContent = content.type === "inline" ? String(content.data) : "";
    const concatenatedData = (existingOutput.data || "") + newContent;

    return [
      tables.outputs
        .update({ data: concatenatedData })
        .where({ id: outputId }),
    ];
  },

  "v1.MarkdownOutputAdded": ({ id, cellId, position, content }, ctx) => {
    const ops = [];
    // Check for pending clears
    const pendingClear = ctx.query(
      tables.pendingClears.select().where({ cellId }).limit(1),
    )[0];
    if (pendingClear) {
      ops.push(tables.outputs.delete().where({ cellId }));
      ops.push(tables.pendingClears.delete().where({ cellId }));
    }

    ops.push(
      tables.outputs.insert({
        id,
        cellId,
        outputType: "markdown",
        position,
        data: content.type === "inline" ? String(content.data) : null,
        artifactId: content.type === "artifact" ? content.artifactId : null,
        mimeType: "text/markdown",
        metadata: content.metadata || null,
        representations: null,
      }),
    );
    return ops;
  },

  "v1.MarkdownOutputAppended": ({ outputId, content }, ctx) => {
    const existingOutput = ctx.query(
      tables.outputs.select().where({ id: outputId }).limit(1),
    )[0];

    if (!existingOutput) {
      return [];
    }

    const newContent = content.type === "inline" ? String(content.data) : "";
    const concatenatedData = (existingOutput.data || "") + newContent;

    return [
      tables.outputs
        .update({ data: concatenatedData })
        .where({ id: outputId }),
    ];
  },

  "v1.ErrorOutputAdded": ({ id, cellId, position, content }, ctx) => {
    const ops = [];
    // Check for pending clears
    const pendingClear = ctx.query(
      tables.pendingClears.select().where({ cellId }).limit(1),
    )[0];
    if (pendingClear) {
      ops.push(tables.outputs.delete().where({ cellId }));
      ops.push(tables.pendingClears.delete().where({ cellId }));
    }

    ops.push(
      tables.outputs.insert({
        id,
        cellId,
        outputType: "error",
        position,
        data: content.type === "inline" ? JSON.stringify(content.data) : null,
        artifactId: content.type === "artifact" ? content.artifactId : null,
        mimeType: "application/json",
        metadata: content.metadata || null,
        representations: null,
      }),
    );
    return ops;
  },

  "v1.CellOutputsCleared": ({ cellId, wait, clearedBy }) => {
    if (wait) {
      // Store pending clear for wait=True
      return tables.pendingClears.insert({ cellId, clearedBy });
    } else {
      // Immediate clear for wait=False
      return tables.outputs.delete().where({ cellId });
    }
  },

  // AI materializers
  "v1.AiSettingsChanged": ({ cellId, provider, model, settings }) =>
    tables.cells
      .update({
        aiProvider: provider,
        aiModel: model,
        aiSettings: settings,
      })
      .where({ id: cellId }),

  // SQL materializers
  "v1.SqlConnectionChanged": ({ cellId, connectionId }) =>
    tables.cells
      .update({
        sqlConnectionId: connectionId ?? null,
      })
      .where({ id: cellId }),

  "v1.SqlResultVariableChanged": ({ cellId, resultVariable }) =>
    tables.cells
      .update({
        sqlResultVariable: resultVariable ?? null,
      })
      .where({ id: cellId }),
});

const state = State.SQLite.makeState({ tables, materializers });

export const schema = makeSchema({ events, state });

export type Store = LiveStore<typeof schema>;

// Type exports derived from the actual table definitions - full type inference works here!
export type NotebookData = typeof tables.notebook.Type;
export type CellData = typeof tables.cells.Type;
export type OutputData = typeof tables.outputs.Type;

export type RuntimeSessionData = typeof tables.runtimeSessions.Type;
export type ExecutionQueueData = typeof tables.executionQueue.Type;
export type UiStateData = typeof tables.uiState.Type;

// Cell types
export type CellType = "code" | "markdown" | "raw" | "sql" | "ai";

// Execution states
export type ExecutionState =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "error";

// Runtime session statuses
export type RuntimeStatus =
  | "starting"
  | "ready"
  | "busy"
  | "restarting"
  | "terminated";

// Queue statuses
export type QueueStatus =
  | "pending"
  | "assigned"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";

// Output types
export type OutputType = "display_data" | "execute_result" | "stream" | "error";

// TypeScript type derived from schema
export type MediaRepresentation = {
  type: "inline";
  data: unknown;
  metadata?: Record<string, unknown>;
} | {
  type: "artifact";
  artifactId: string;
  metadata?: Record<string, unknown>;
};

// Output data types for different output formats
export interface RichOutputData {
  "text/plain"?: string;
  "text/markdown"?: string;
  "text/html"?: string;
  "image/svg+xml"?: string;
  "image/svg"?: string;
  "application/json"?: unknown;
  [key: string]: unknown;
}

// Error output structure
// Error output data structure for unified system
export interface ErrorOutputData {
  ename: string;
  evalue: string;
  traceback: string[];
}

// Stream output structure
export interface StreamOutputData {
  name: "stdout" | "stderr";
  text: string;
}

// Type guards for output data
export function isErrorOutput(data: unknown): data is ErrorOutputData {
  return (
    typeof data === "object" &&
    data !== null &&
    "ename" in data &&
    "evalue" in data &&
    typeof (data as ErrorOutputData).ename === "string" &&
    typeof (data as ErrorOutputData).evalue === "string"
  );
}

export function isStreamOutput(data: unknown): data is StreamOutputData {
  return (
    typeof data === "object" &&
    data !== null &&
    "name" in data &&
    "text" in data &&
    ["stdout", "stderr"].includes((data as StreamOutputData).name) &&
    typeof (data as StreamOutputData).text === "string"
  );
}

export function isRichOutput(data: unknown): data is RichOutputData {
  return (
    typeof data === "object" &&
    data !== null &&
    !isErrorOutput(data) &&
    !isStreamOutput(data)
  );
}

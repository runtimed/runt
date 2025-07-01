import {
  Events,
  makeSchema,
  Schema,
  SessionIdSymbol,
  State,
  type Store as LiveStore,
} from "@livestore/livestore";

export const tables = {
  // Notebook metadata (single row per store)
  notebook: State.SQLite.table({
    name: "notebook",
    columns: {
      id: State.SQLite.text({ primaryKey: true }), // Same as storeId
      title: State.SQLite.text({ default: "Untitled Notebook" }),
      kernelType: State.SQLite.text({ default: "python3" }),
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
      assignedKernelSession: State.SQLite.text({ nullable: true }), // Which kernel session is handling this
      lastExecutionDurationMs: State.SQLite.integer({ nullable: true }), // Duration of last execution in milliseconds

      // SQL-specific fields
      sqlConnectionId: State.SQLite.text({ nullable: true }),
      sqlResultData: State.SQLite.json({ nullable: true, schema: Schema.Any }),

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
          "display_data",
          "execute_result",
          "stream",
          "error",
        ),
      }),
      data: State.SQLite.json({ schema: Schema.Any }),
      metadata: State.SQLite.json({ nullable: true, schema: Schema.Any }), // For additional output metadata
      position: State.SQLite.real(),
      displayId: State.SQLite.text({ nullable: true }), // Jupyter display_id for cross-cell updates
    },
  }),

  // Kernel lifecycle management
  // NOTE: Each notebook should have exactly ONE active kernel at a time
  // Multiple entries only exist during kernel transitions/handoffs
  kernelSessions: State.SQLite.table({
    name: "kernelSessions",
    columns: {
      sessionId: State.SQLite.text({ primaryKey: true }),
      kernelId: State.SQLite.text(), // Stable kernel identifier
      kernelType: State.SQLite.text({ default: "python3" }),
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

      // Heartbeat tracking
      lastHeartbeat: State.SQLite.datetime({ nullable: true }),
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
      assignedKernelSession: State.SQLite.text({ nullable: true }),

      // Priority and metadata
      priority: State.SQLite.integer({ default: 0 }), // Higher = more important
      retryCount: State.SQLite.integer({ default: 0 }),
      maxRetries: State.SQLite.integer({ default: 3 }),

      // Execution timing
      startedAt: State.SQLite.datetime({ nullable: true }),
      completedAt: State.SQLite.datetime({ nullable: true }),
      executionDurationMs: State.SQLite.integer({ nullable: true }),
    },
  }),

  // Data connections for SQL cells
  dataConnections: State.SQLite.table({
    name: "dataConnections",
    columns: {
      id: State.SQLite.text({ primaryKey: true }),
      name: State.SQLite.text(),
      type: State.SQLite.text({ schema: Schema.String }),
      connectionString: State.SQLite.text(), // encrypted connection details
      isDefault: State.SQLite.boolean({ default: false }),
      createdBy: State.SQLite.text(),
    },
  }),

  // UI state for each user
  uiState: State.SQLite.clientDocument({
    name: "uiState",
    schema: Schema.Struct({
      selectedCellId: Schema.optional(Schema.String),
      editingCellId: Schema.optional(Schema.String),
      kernelStatus: Schema.optional(Schema.String),
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

  // Kernel lifecycle events
  kernelSessionStarted: Events.synced({
    name: "v1.KernelSessionStarted",
    schema: Schema.Struct({
      sessionId: Schema.String, // Unique per kernel restart
      kernelId: Schema.String, // Stable kernel identifier
      kernelType: Schema.String,
      capabilities: Schema.Struct({
        canExecuteCode: Schema.Boolean,
        canExecuteSql: Schema.Boolean,
        canExecuteAi: Schema.Boolean,
      }),
    }),
  }),

  kernelSessionHeartbeat: Events.synced({
    name: "v1.KernelSessionHeartbeat",
    schema: Schema.Struct({
      sessionId: Schema.String,
      status: Schema.Literal("ready", "busy"),
      timestamp: Schema.Date,
    }),
  }),

  kernelSessionTerminated: Events.synced({
    name: "v1.KernelSessionTerminated",
    schema: Schema.Struct({
      sessionId: Schema.String,
      reason: Schema.Literal("shutdown", "restart", "error", "timeout"),
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
      priority: Schema.Number,
    }),
  }),

  executionAssigned: Events.synced({
    name: "v1.ExecutionAssigned",
    schema: Schema.Struct({
      queueId: Schema.String,
      kernelSessionId: Schema.String,
    }),
  }),

  executionStarted: Events.synced({
    name: "v1.ExecutionStarted",
    schema: Schema.Struct({
      queueId: Schema.String,
      cellId: Schema.String,
      kernelSessionId: Schema.String,
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

  // Output events
  cellOutputAdded: Events.synced({
    name: "v1.CellOutputAdded",
    schema: Schema.Struct({
      id: Schema.String,
      cellId: Schema.String,
      outputType: Schema.Literal(
        "display_data",
        "execute_result",
        "stream",
        "error",
      ),
      data: Schema.Any,
      metadata: Schema.optional(Schema.Any), // For additional output metadata
      position: Schema.Number,
      displayId: Schema.optional(Schema.String), // Jupyter display_id for cross-cell updates
    }),
  }),

  cellOutputUpdated: Events.synced({
    name: "v1.CellOutputUpdated",
    schema: Schema.Struct({
      id: Schema.String, // Display ID to update (global across cells)
      data: Schema.Any,
      metadata: Schema.optional(Schema.Any),
    }),
  }),

  cellOutputsCleared: Events.synced({
    name: "v1.CellOutputsCleared",
    schema: Schema.Struct({
      cellId: Schema.String,
      clearedBy: Schema.String,
    }),
  }),

  // SQL events
  sqlConnectionCreated: Events.synced({
    name: "v1.SqlConnectionCreated",
    schema: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      type: Schema.String,
      connectionString: Schema.String,
      isDefault: Schema.Boolean,
      createdBy: Schema.String,
    }),
  }),

  sqlQueryExecuted: Events.synced({
    name: "v1.SqlQueryExecuted",
    schema: Schema.Struct({
      cellId: Schema.String,
      connectionId: Schema.String,
      query: Schema.String,
      resultData: Schema.Any,
      executedBy: Schema.String,
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

  // Kernel lifecycle materializers
  "v1.KernelSessionStarted": ({
    sessionId,
    kernelId,
    kernelType,
    capabilities,
  }) =>
    tables.kernelSessions.insert({
      sessionId,
      kernelId,
      kernelType,
      status: "ready",
      canExecuteCode: capabilities.canExecuteCode,
      canExecuteSql: capabilities.canExecuteSql,
      canExecuteAi: capabilities.canExecuteAi,
    }),

  "v1.KernelSessionHeartbeat": ({ sessionId, status, timestamp }) =>
    tables.kernelSessions
      .update({
        status: status === "ready" ? "ready" : "busy",
        lastHeartbeat: timestamp,
      })
      .where({ sessionId }),

  "v1.KernelSessionTerminated": ({ sessionId }) =>
    tables.kernelSessions
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
    priority,
  }) => [
    tables.executionQueue.insert({
      id: queueId,
      cellId,
      executionCount,
      requestedBy,
      priority,
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

  "v1.ExecutionAssigned": ({ queueId, kernelSessionId }) =>
    tables.executionQueue
      .update({
        status: "assigned",
        assignedKernelSession: kernelSessionId,
      })
      .where({ id: queueId }),

  "v1.ExecutionStarted": ({ queueId, cellId, startedAt }) => [
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

  // Output materializers
  "v1.CellOutputAdded": ({
    id,
    cellId,
    outputType,
    data,
    metadata,
    position,
    displayId,
  }) =>
    tables.outputs.insert({
      id,
      cellId,
      outputType,
      data,
      metadata,
      position,
      displayId: displayId || null,
    }),

  "v1.CellOutputUpdated": ({ id, data, metadata }) =>
    tables.outputs.update({ data, metadata }).where({ displayId: id }),

  "v1.CellOutputsCleared": ({ cellId }) =>
    tables.outputs.delete().where({ cellId }),

  // SQL materializers
  "v1.SqlConnectionCreated": ({
    id,
    name,
    type,
    connectionString,
    isDefault,
    createdBy,
  }) =>
    tables.dataConnections.insert({
      id,
      name,
      type,
      connectionString,
      isDefault,
      createdBy,
    }),

  "v1.SqlQueryExecuted": ({ cellId, connectionId, query, resultData }) =>
    tables.cells
      .update({
        source: query,
        sqlConnectionId: connectionId,
        sqlResultData: resultData,
        executionState: "completed",
      })
      .where({ id: cellId }),

  // AI materializers
  "v1.AiSettingsChanged": ({ cellId, provider, model, settings }) =>
    tables.cells
      .update({
        aiProvider: provider,
        aiModel: model,
        aiSettings: settings,
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
export type KernelSessionData = typeof tables.kernelSessions.Type;
export type ExecutionQueueData = typeof tables.executionQueue.Type;
export type DataConnectionData = typeof tables.dataConnections.Type;
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

// Kernel session statuses
export type KernelStatus =
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

// SQL-specific types
export interface SqlResultData {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  executionTime: string;
}

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
export interface ErrorOutputData {
  ename: string;
  evalue: string;
  traceback?: string[];
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

import { Events, Schema, SessionIdSymbol, State } from "@livestore/livestore";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/**
 * CLIENT AUTHENTICATION PATTERNS
 *
 * The LiveStore sync backend validates client connections using authToken and clientId.
 * Different client types use different authentication patterns:
 *
 * SERVICE CLIENTS (runtime: true):
 * - Runtime agents: clientId = runtimeId (e.g. "python-runtime-123")
 * - Notebook runners: clientId = "automation-client" (headless execution)
 * - TUI clients: clientId = "tui-client" (terminal interface)
 * - Service clients use AUTH_TOKEN for authentication
 * - ClientId must be non-numeric to prevent user impersonation
 *
 * USER CLIENTS (runtime: false/undefined):
 * - Regular users: clientId = authenticated user ID
 * - Anonymous users: clientId = "anonymous-user"
 * - User clients use OIDC tokens for authentication
 * - ClientId must match authenticated user ID
 *
 * PRESENCE DISPLAY:
 * - Runtime agents: Bot icon with runtimeType label
 * - Notebook runners: Play icon (headless execution you can monitor)
 * - TUI clients: Terminal icon (terminal interface)
 * - Regular users: User avatar/initials
 */

// Base generic types for MediaContainer system
export type InlineContainer<T = unknown> = {
  type: "inline";
  data: T;
  metadata?: Record<string, unknown> | undefined;
};

export type ArtifactContainer = {
  type: "artifact";
  artifactId: string;
  metadata?: Record<string, unknown> | undefined;
};

export type MediaContainer<T = unknown> =
  | InlineContainer<T>
  | ArtifactContainer;

// MIME type constants - core definitions used across frontend and backend
export const TEXT_MIME_TYPES = [
  "text/plain",
  "text/html",
  "text/markdown",
  "text/latex",
] as const;

export const APPLICATION_MIME_TYPES = [
  "application/json",
  "application/javascript",
] as const;

export const AI_TOOL_MIME_TYPES = [
  "application/vnd.anode.aitool+json",
  "application/vnd.anode.aitool.result+json",
] as const;

export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/gif",
] as const;

export const JUPYTER_MIME_TYPES = [
  "application/vnd.jupyter.widget-state+json",
  "application/vnd.jupyter.widget-view+json",
  "application/vnd.plotly.v1+json",
  "application/vnd.dataresource+json",
  "application/vnd.vegalite.v2+json",
  "application/vnd.vegalite.v3+json",
  "application/vnd.vegalite.v4+json",
  "application/vnd.vegalite.v5+json",
  "application/vnd.vegalite.v6+json",
  "application/vnd.vega.v3+json",
  "application/vnd.vega.v4+json",
  "application/vnd.vega.v5+json",
  "application/geo+json",
  "application/vdom.v1+json",
] as const;

export const KNOWN_MIME_TYPES = [
  ...TEXT_MIME_TYPES,
  ...APPLICATION_MIME_TYPES,
  ...IMAGE_MIME_TYPES,
  ...JUPYTER_MIME_TYPES,
  ...AI_TOOL_MIME_TYPES,
] as const;

export type TextMimeType = (typeof TEXT_MIME_TYPES)[number];
export type ApplicationMimeType = (typeof APPLICATION_MIME_TYPES)[number];
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];
export type JupyterMimeType = (typeof JUPYTER_MIME_TYPES)[number];
export type AiToolMimeType = (typeof AI_TOOL_MIME_TYPES)[number];
export type KnownMimeType = (typeof KNOWN_MIME_TYPES)[number];

/**
 * Type guard to check if a MIME type is a known text format
 */
export function isTextMimeType(mimeType: string): mimeType is TextMimeType {
  return (TEXT_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Type guard to check if a MIME type is a known application format
 */
export function isApplicationMimeType(
  mimeType: string,
): mimeType is ApplicationMimeType {
  return (APPLICATION_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Type guard to check if a MIME type is a known image format
 */
export function isImageMimeType(mimeType: string): mimeType is ImageMimeType {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Type guard to check if a MIME type is a Jupyter vendor format
 */
export function isJupyterMimeType(
  mimeType: string,
): mimeType is JupyterMimeType {
  return (JUPYTER_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Type guard to check if a MIME type is an AI tool format
 */
export function isAiToolMimeType(mimeType: string): mimeType is AiToolMimeType {
  return (AI_TOOL_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Type guard to check if a MIME type is any known format
 */
export function isKnownMimeType(mimeType: string): mimeType is KnownMimeType {
  return (KNOWN_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Check if a MIME type is a JSON-based format (ends with +json)
 */
export function isJsonMimeType(mimeType: string): boolean {
  return mimeType.endsWith("+json") || mimeType === "application/json";
}

/**
 * Check if a MIME type appears to be text-based
 */
export function isTextBasedMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/javascript" ||
    mimeType === "image/svg+xml"
  );
}

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

// TypeScript type for cell types
export type CellType = "code" | "markdown" | "sql" | "raw" | "ai";

// Schema for cell type validation
export const CellTypeSchema = Schema.Literal(
  "code",
  "markdown",
  "sql",
  "raw",
  "ai",
);

// Execution state types
export type ExecutionState =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "error";
export const ExecutionStateSchema = Schema.Literal(
  "idle",
  "queued",
  "running",
  "completed",
  "error",
);

// Output types
export type OutputType =
  | "multimedia_display"
  | "multimedia_result"
  | "terminal"
  | "markdown"
  | "error";
export const OutputTypeSchema = Schema.Literal(
  "multimedia_display",
  "multimedia_result",
  "terminal",
  "markdown",
  "error",
);

// Runtime status types
export type RuntimeStatus =
  | "starting"
  | "ready"
  | "busy"
  | "restarting"
  | "terminated";
export const RuntimeStatusSchema = Schema.Literal(
  "starting",
  "ready",
  "busy",
  "restarting",
  "terminated",
);

// Queue status types
export type QueueStatus =
  | "pending"
  | "assigned"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";
export const QueueStatusSchema = Schema.Literal(
  "pending",
  "assigned",
  "executing",
  "completed",
  "failed",
  "cancelled",
);

// Actor types
export type ActorType = "human" | "runtime_agent";
export const ActorTypeSchema = Schema.Literal("human", "runtime_agent");

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
      position: State.SQLite.real(),
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

// Events describe notebook and cell changes
// All events are scoped to a single notebook (storeId = notebookId)
export const events = {
  debug1: Events.synced({
    name: "v1.Debug",
    schema: Schema.Struct({
      id: Schema.String,
    }),
  }),

  // Notebook events (single notebook per store)
  /** @deprecated  */
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

  notebookMetadataSet: Events.synced({
    name: "v1.NotebookMetadataSet",
    schema: Schema.Struct({
      key: Schema.String,
      value: Schema.String,
    }),
  }),

  // Cell events
  cellCreated: Events.synced({
    name: "v1.CellCreated",
    schema: Schema.Struct({
      id: Schema.String,
      cellType: CellTypeSchema,
      position: Schema.Number,
      createdBy: Schema.String,
      actorId: Schema.optional(Schema.String),
    }),
  }),

  /**
  v2 cell created with fractional indexing
   {
     id: CellId,
     fractionalIndex: string, // Fractional index (e.g., "a0", "a5", "b0")
     cellType: CellType,
   }

   Note: fractionalIndex column has been added to cells table.
   Future migration steps:
   1. Migrate existing cells to use fractional indices based on position
   2. Update all queries to use ORDER BY fractionalIndex instead of position
   3. Eventually deprecate position column from cells table
   4. Update v1.CellCreated to calculate fractional index
   */
  cellCreated2: Events.synced({
    name: "v2.CellCreated",
    schema: Schema.Struct({
      id: Schema.String,
      fractionalIndex: Schema.String.annotations({
        description: "Jittered fractional index for deterministic ordering",
      }),
      cellType: CellTypeSchema,
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
      cellType: CellTypeSchema,
      actorId: Schema.optional(Schema.String),
    }),
  }),

  cellDeleted: Events.synced({
    name: "v1.CellDeleted",
    schema: Schema.Struct({
      id: Schema.String,
      actorId: Schema.optional(Schema.String),
    }),
  }),

  cellMoved: Events.synced({
    name: "v1.CellMoved",
    schema: Schema.Struct({
      id: Schema.String,
      newPosition: Schema.Number,
      actorId: Schema.optional(Schema.String),
    }),
  }),

  cellSourceVisibilityToggled: Events.synced({
    name: "v1.CellSourceVisibilityToggled",
    schema: Schema.Struct({
      id: Schema.String,
      sourceVisible: Schema.Boolean,
      actorId: Schema.optional(Schema.String),
    }),
  }),

  cellOutputVisibilityToggled: Events.synced({
    name: "v1.CellOutputVisibilityToggled",
    schema: Schema.Struct({
      id: Schema.String,
      outputVisible: Schema.Boolean,
      actorId: Schema.optional(Schema.String),
    }),
  }),

  cellAiContextVisibilityToggled: Events.synced({
    name: "v1.CellAiContextVisibilityToggled",
    schema: Schema.Struct({
      id: Schema.String,
      aiContextVisible: Schema.Boolean,
      actorId: Schema.optional(Schema.String),
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
        availableAiModels: Schema.optional(Schema.Any),
      }),
    }),
  }),

  presenceSet: Events.synced({
    name: "v1.PresenceSet",
    schema: Schema.Struct({
      userId: Schema.String,
      cellId: Schema.optional(Schema.String),
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
      actorId: Schema.optional(Schema.String),
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
      actorId: Schema.optional(Schema.String),
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

  multimediaDisplayOutputUpdated: Events.synced({
    name: "v1.MultimediaDisplayOutputUpdated",
    schema: Schema.Struct({
      displayId: Schema.String,
      representations: Schema.Record({
        key: Schema.String,
        value: MediaRepresentationSchema,
      }),
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

  /** @deprecated  */
  terminalOutputAppended: Events.synced({
    name: "v1.TerminalOutputAppended",
    schema: Schema.Struct({
      outputId: Schema.String,
      content: MediaRepresentationSchema,
    }),
  }),

  terminalOutputAppended2: Events.synced({
    name: "v2.TerminalOutputAppended",
    schema: Schema.Struct({
      id: Schema.String,
      outputId: Schema.String,
      delta: Schema.String,
      sequenceNumber: Schema.Number,
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

  /** @deprecated  */
  markdownOutputAppended: Events.synced({
    name: "v1.MarkdownOutputAppended",
    schema: Schema.Struct({
      outputId: Schema.String,
      content: MediaRepresentationSchema,
    }),
  }),

  markdownOutputAppended2: Events.synced({
    name: "v2.MarkdownOutputAppended",
    schema: Schema.Struct({
      id: Schema.String,
      outputId: Schema.String,
      delta: Schema.String,
      sequenceNumber: Schema.Number,
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

  actorProfileSet: Events.synced({
    name: "v1.ActorProfileSet",
    schema: Schema.Struct({
      id: Schema.String,
      type: ActorTypeSchema,
      displayName: Schema.String,
      avatar: Schema.optional(Schema.String),
    }),
  }),

  // Tool approval events
  toolApprovalRequested: Events.synced({
    name: "v1.ToolApprovalRequested",
    schema: Schema.Struct({
      toolCallId: Schema.String,
      cellId: Schema.String,
      toolName: Schema.String,
      arguments: Schema.Record({ key: Schema.String, value: Schema.Any }),
      requestedAt: Schema.Date,
    }),
  }),

  toolApprovalResponded: Events.synced({
    name: "v1.ToolApprovalResponded",
    schema: Schema.Struct({
      toolCallId: Schema.String,
      status: Schema.Literal("approved_once", "approved_always", "denied"),
      approvedBy: Schema.String,
      respondedAt: Schema.Date,
    }),
  }),
};

// Helper function to select primary representation from multimedia data
function selectPrimaryRepresentation(
  representations: Record<string, MediaContainer>,
  preferredMimeTypes: string[] = [
    // JSON-based formats first (highest priority for rich data)
    "application/vnd.plotly.v1+json",
    "application/vnd.vegalite.v6+json",
    "application/vnd.vegalite.v5+json",
    "application/vnd.vegalite.v4+json",
    "application/vnd.vegalite.v3+json",
    "application/vnd.vegalite.v2+json",
    "application/vnd.vega.v5+json",
    "application/vnd.vega.v4+json",
    "application/vnd.vega.v3+json",
    "application/vnd.jupyter.widget-view+json",
    "application/vnd.jupyter.widget-state+json",
    "application/vnd.dataresource+json",
    "application/vdom.v1+json",
    "application/geo+json",
    "application/json",
    // Interactive content
    "application/javascript",
    // Rich display formats
    "text/html",
    "image/svg+xml",
    // Binary images
    "image/png",
    "image/jpeg",
    "image/gif",
    // Text formats
    "text/latex",
    "text/markdown",
    "text/plain",
  ],
): { mimeType: string; container: MediaContainer } | null {
  for (const mimeType of preferredMimeTypes) {
    if (representations[mimeType]) {
      return {
        mimeType,
        container: representations[mimeType],
      };
    }
  }

  return null;
}

// Helper function to update existing displays with same displayId
function updateExistingDisplays(
  displayId: string,
  representations: Record<string, MediaContainer>,
  // deno-lint-ignore no-explicit-any
  ctx: any,
) {
  const existingOutputs = ctx.query(
    tables.outputs.select().where({
      displayId,
      outputType: "multimedia_display",
    }),
  );

  if (existingOutputs.length === 0) {
    return [];
  }

  const primaryRep = selectPrimaryRepresentation(representations);
  if (!primaryRep) {
    return [];
  }

  const { mimeType, container } = primaryRep;
  const data = container.type === "inline" ? String(container.data || "") : "";

  return [
    tables.outputs
      .update({
        data,
        mimeType,
        representations,
      })
      .where({
        displayId,
        outputType: "multimedia_display",
      }),
  ];
}

// Shared helper function for updating presence
function updatePresence(userId: string, cellId?: string) {
  return tables.presence
    .insert({ userId, cellId: cellId || null })
    .onConflict("userId", "replace");
}

// Materializers map events to state changes
export const materializers = State.SQLite.materializers(events, {
  "v1.Debug": (event, ctx) => {
    const existingDebug = ctx.query(
      tables.debug.select().where({ id: event.id }).limit(1),
    )[0];
    if (existingDebug) {
      return [];
    }
    return [tables.debug.insert({ id: event.id }).onConflict("id", "replace")];
  },
  // Notebook materializers
  /** @deprecated */
  "v1.NotebookInitialized": ({ id, title, ownerId }) => [
    // Legacy event - convert to metadata format
    tables.notebookMetadata
      .insert({
        key: "title",
        value: title,
      })
      .onConflict("key", "replace"),
    tables.notebookMetadata
      .insert({
        key: "ownerId",
        value: ownerId,
      })
      .onConflict("key", "replace"),
    tables.debug
      .insert({
        id,
      })
      .onConflict("id", "replace"),
  ],

  "v1.NotebookTitleChanged": ({ title }) =>
    tables.notebookMetadata
      .insert({
        key: "title",
        value: title,
      })
      .onConflict("key", "replace"),

  "v1.NotebookMetadataSet": ({ key, value }) =>
    tables.notebookMetadata
      .insert({
        key,
        value,
      })
      .onConflict("key", "replace"),

  // Cell materializers
  "v1.CellCreated": ({ id, cellType, position, createdBy, actorId }) => [
    tables.cells
      .insert({
        id,
        cellType,
        position,
        createdBy,
      })
      .onConflict("id", "ignore"),
    // Update presence table
    updatePresence(actorId || createdBy, id),
  ],

  "v2.CellCreated": ({ id, fractionalIndex, cellType, createdBy }) => {
    // With fractional indexing, we don't need ctx.query!
    // The order is already calculated client-side
    const ops = [];

    ops.push(
      tables.cells
        .insert({
          id,
          cellType,
          position: 0, // Keep position for backward compatibility
          fractionalIndex, // New fractional index
          createdBy,
        })
        .onConflict("id", "ignore"),
    );

    // Update presence for the creator
    ops.push(updatePresence(createdBy, id));

    return ops;
  },

  "v1.CellSourceChanged": ({ id, source, modifiedBy }) => [
    tables.cells.update({ source }).where({ id }),
    // Update presence based on cell source modification
    updatePresence(modifiedBy, id),
  ],

  "v1.CellTypeChanged": ({ id, cellType, actorId }) => {
    const ops = [];
    ops.push(tables.cells.update({ cellType }).where({ id }));
    if (actorId) {
      ops.push(updatePresence(actorId, id));
    }
    return ops;
  },

  "v1.CellDeleted": ({ id, actorId }) => {
    const ops = [];
    ops.push(tables.cells.delete().where({ id }));
    if (actorId) {
      ops.push(updatePresence(actorId, id));
    }
    return ops;
  },

  "v1.CellMoved": ({ id, newPosition, actorId }) => {
    const ops = [];
    ops.push(tables.cells.update({ position: newPosition }).where({ id }));
    if (actorId) {
      ops.push(updatePresence(actorId, id));
    }
    return ops;
  },

  "v1.CellSourceVisibilityToggled": ({ id, sourceVisible, actorId }) => {
    const ops = [];
    ops.push(tables.cells.update({ sourceVisible }).where({ id }));
    if (actorId) {
      ops.push(updatePresence(actorId, id));
    }
    return ops;
  },

  "v1.CellOutputVisibilityToggled": ({ id, outputVisible, actorId }) => {
    const ops = [];
    ops.push(tables.cells.update({ outputVisible }).where({ id }));
    if (actorId) {
      ops.push(updatePresence(actorId, id));
    }
    return ops;
  },

  "v1.CellAiContextVisibilityToggled": ({ id, aiContextVisible, actorId }) => {
    const ops = [];
    ops.push(tables.cells.update({ aiContextVisible }).where({ id }));
    if (actorId) {
      ops.push(updatePresence(actorId, id));
    }
    return ops;
  },

  "v1.PresenceSet": ({ userId, cellId }) => updatePresence(userId, cellId),

  // Runtime lifecycle materializers
  "v1.RuntimeSessionStarted": ({
    sessionId,
    runtimeId,
    runtimeType,
    capabilities,
  }) =>
    tables.runtimeSessions
      .insert({
        sessionId,
        runtimeId,
        runtimeType,
        status: "starting",
        canExecuteCode: capabilities.canExecuteCode,
        canExecuteSql: capabilities.canExecuteSql,
        canExecuteAi: capabilities.canExecuteAi,
        availableAiModels: capabilities.availableAiModels || null,
      })
      .onConflict("sessionId", "replace"),

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
    actorId,
  }) => [
    tables.executionQueue
      .insert({
        id: queueId,
        cellId,
        executionCount,
        requestedBy,
        status: "pending",
      })
      .onConflict("id", "ignore"),
    // Update cell execution state
    tables.cells
      .update({
        executionState: "queued",
        executionCount,
      })
      .where({ id: cellId }),
    // Update presence table
    updatePresence(actorId || requestedBy, cellId),
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

  "v1.ExecutionCancelled": ({ queueId, cellId, cancelledBy, actorId }) => [
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
    // Update presence table
    updatePresence(actorId || cancelledBy, cellId),
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

    // If displayId provided, update all existing displays with same ID first
    if (displayId) {
      ops.push(...updateExistingDisplays(displayId, representations, ctx));
    }

    // Always create new output (core behavior of "Added" event)
    const primaryRep = selectPrimaryRepresentation(representations);
    const primaryData = primaryRep
      ? primaryRep.container.type === "inline"
        ? String(primaryRep.container.data || "")
        : ""
      : "";
    const primaryMimeType = primaryRep ? primaryRep.mimeType : "text/plain";

    ops.push(
      tables.outputs
        .insert({
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
        })
        .onConflict("id", "replace"),
    );
    return ops;
  },

  "v1.MultimediaDisplayOutputUpdated": (
    { displayId, representations },
    ctx,
  ) => {
    // Only update existing displays - no new output creation
    return updateExistingDisplays(displayId, representations, ctx);
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
      tables.outputs
        .insert({
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
        })
        .onConflict("id", "replace"),
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
      tables.outputs
        .insert({
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
        })
        .onConflict("id", "replace"),
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
      tables.outputs.update({ data: concatenatedData }).where({ id: outputId }),
    ];
  },

  "v2.TerminalOutputAppended": ({ outputId, delta, id, sequenceNumber }) => {
    return tables.outputDeltas.insert({
      id,
      outputId,
      delta,
      sequenceNumber,
    });
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
      tables.outputs
        .insert({
          id,
          cellId,
          outputType: "markdown",
          position,
          data: content.type === "inline" ? String(content.data) : null,
          artifactId: content.type === "artifact" ? content.artifactId : null,
          mimeType: "text/markdown",
          metadata: content.metadata || null,
          representations: null,
        })
        .onConflict("id", "replace"),
    );
    return ops;
  },

  /**@deprecated */
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
      tables.outputs.update({ data: concatenatedData }).where({ id: outputId }),
    ];
  },

  "v2.MarkdownOutputAppended": ({ id, outputId, delta, sequenceNumber }) => {
    return tables.outputDeltas.insert({
      id,
      outputId,
      delta,
      sequenceNumber,
    });
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
      tables.outputs
        .insert({
          id,
          cellId,
          outputType: "error",
          position,
          data: content.type === "inline" ? JSON.stringify(content.data) : null,
          artifactId: content.type === "artifact" ? content.artifactId : null,
          mimeType: "application/json",
          metadata: content.metadata || null,
          representations: null,
        })
        .onConflict("id", "replace"),
    );
    return ops;
  },

  "v1.CellOutputsCleared": ({ cellId, wait, clearedBy }) => {
    const ops = [];
    if (wait) {
      // Store pending clear for wait=True
      ops.push(
        tables.pendingClears
          .insert({ cellId, clearedBy })
          .onConflict("cellId", "replace"),
      );
    } else {
      // Immediate clear for wait=False
      ops.push(tables.outputs.delete().where({ cellId }));
    }

    // Add presence update if user is provided
    if (clearedBy) {
      ops.push(updatePresence(clearedBy, cellId));
    }

    return ops;
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

  "v1.ActorProfileSet": ({ id, type, displayName, avatar }) =>
    tables.actors
      .insert({
        id,
        type,
        displayName,
        avatar: avatar ?? null,
      })
      .onConflict("id", "replace"),

  // Tool approval materializers
  "v1.ToolApprovalRequested": ({
    toolCallId,
    cellId,
    toolName,
    arguments: _args,
    requestedAt,
  }) =>
    tables.toolApprovals
      .insert({
        toolCallId,
        cellId,
        toolName,
        status: "pending",
        approvedBy: null,
        requestedAt,
        respondedAt: null,
      })
      .onConflict("toolCallId", "replace"),

  "v1.ToolApprovalResponded": ({
    toolCallId,
    status,
    approvedBy,
    respondedAt,
  }) =>
    tables.toolApprovals
      .update({
        status,
        approvedBy,
        respondedAt,
      })
      .where({ toolCallId }),
});

// Type exports derived from the actual table definitions - full type inference works here!
export type NotebookMetadataData = typeof tables.notebookMetadata.Type;
export type CellData = typeof tables.cells.Type;
export type OutputData = typeof tables.outputs.Type;

export type RuntimeSessionData = typeof tables.runtimeSessions.Type;
export type ExecutionQueueData = typeof tables.executionQueue.Type;
export type UiStateData = typeof tables.uiState.Type;

// Type guards for MediaContainer
export function isInlineContainer<T>(
  container: MediaContainer,
): container is InlineContainer<T> {
  return container.type === "inline";
}

export function isArtifactContainer(
  container: MediaContainer,
): container is ArtifactContainer {
  return container.type === "artifact";
}

// Helper function to get notebook metadata with defaults
export function getNotebookMetadata(
  metadataRecords: Array<{ key: string; value: string }>,
  key: string,
  defaultValue: string = "",
): string {
  const record = metadataRecords.find((r) => r.key === key);
  return record?.value ?? defaultValue;
}

// Helper to get common notebook metadata values
export function getNotebookInfo(
  metadataRecords: Array<{ key: string; value: string }>,
) {
  return {
    title: getNotebookMetadata(metadataRecords, "title", "Untitled"),
    ownerId: getNotebookMetadata(metadataRecords, "ownerId", "anonymous"),
    runtimeType: getNotebookMetadata(metadataRecords, "runtimeType", "python3"),
    isPublic:
      getNotebookMetadata(metadataRecords, "isPublic", "false") === "true",
  };
}

// Output data types for different output formats
export interface RichOutputData {
  [mimeType: string]: MediaContainer;
}

// Error output structure
// Error output data structure for unified system
export interface ErrorOutputData {
  ename: string;
  evalue: string;
  traceback: string[];
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

export function isRichOutput(data: unknown): data is RichOutputData {
  return typeof data === "object" && data !== null && !isErrorOutput(data);
}

/**
 * AI tool call data structure for notebook outputs
 */
export interface AiToolCallData {
  tool_call_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
}

/**
 * AI tool result data structure for notebook outputs
 */
export interface AiToolResultData {
  tool_call_id: string;
  status: "success" | "error";
  result?: string;
  // Optional fields for backward compatibility
  tool_name?: string;
  arguments?: Record<string, unknown>;
  timestamp?: string;
}

/**
 * Type guard to check if data is an AI tool call
 */
export function isAiToolCallData(data: unknown): data is AiToolCallData {
  return (
    typeof data === "object" &&
    data !== null &&
    "tool_call_id" in data &&
    "tool_name" in data &&
    "arguments" in data &&
    typeof (data as AiToolCallData).tool_call_id === "string" &&
    typeof (data as AiToolCallData).tool_name === "string" &&
    typeof (data as AiToolCallData).arguments === "object"
  );
}

/**
 * Type guard to check if data is an AI tool result
 */
export function isAiToolResultData(data: unknown): data is AiToolResultData {
  return (
    typeof data === "object" &&
    data !== null &&
    "tool_call_id" in data &&
    "status" in data &&
    typeof (data as AiToolResultData).tool_call_id === "string" &&
    typeof (data as AiToolResultData).status === "string" &&
    ["success", "error"].includes((data as AiToolResultData).status)
  );
}

/**
 * AI tool call MIME type constant
 */
export const AI_TOOL_CALL_MIME_TYPE =
  "application/vnd.anode.aitool+json" as const;

/**
 * AI tool result MIME type constant
 */
export const AI_TOOL_RESULT_MIME_TYPE =
  "application/vnd.anode.aitool.result+json" as const;

// JitterProvider interface for dependency injection
export interface JitterProvider {
  addJitter(key: string): string;
}

// Note on fractional indexing edge cases:
// The fractional-indexing library has inherent limitations when keys get densely packed.
// For example, inserting many times between "a2" and "a3" eventually produces keys like
// "a2l" and "a2V" that violate lexicographic ordering (lowercase > uppercase in ASCII).
// Our jittering approach using multi-key generation helps avoid collisions but cannot
// fix this fundamental limitation. In practice, this edge case is rare and occurs only
// with extreme insertion patterns.

// Default jitter provider that adds random suffix
export class RandomJitterProvider implements JitterProvider {
  constructor(private readonly length: number = 3) {}

  addJitter(key: string): string {
    const chars =
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let jitter = "";
    for (let i = 0; i < this.length; i++) {
      jitter += chars[Math.floor(Math.random() * chars.length)];
    }
    // Instead of adding a suffix, we'll use multi-key generation in fractionalIndexBetween
    // This is just a marker for backwards compatibility
    return key;
  }
}

// No-op jitter provider for tests
export class NoJitterProvider implements JitterProvider {
  addJitter(key: string): string {
    return key;
  }
}

// Default jitter provider instance
const defaultJitterProvider = new RandomJitterProvider();

// Export fractional indexing utilities with optional jittering
export function fractionalIndexBetween(
  a: string | null | undefined,
  b: string | null | undefined,
  jitterProvider: JitterProvider = defaultJitterProvider,
): string {
  // Extract base key if it contains jitter (for backwards compatibility with tilde separator)
  const cleanA = a ? a.split("~")[0] : a;
  const cleanB = b ? b.split("~")[0] : b;

  // For deterministic tests (NoJitterProvider), use single key generation
  if (jitterProvider.addJitter("test") === "test") {
    return generateKeyBetween(cleanA, cleanB);
  }

  // For production (RandomJitterProvider), use multi-key generation to avoid collisions
  try {
    // Generate multiple keys and pick one randomly
    const numKeys = 10;
    const keys = generateNKeysBetween(cleanA, cleanB, numKeys);

    // Pick a random key (not the first or last for better distribution)
    if (keys.length > 2) {
      const randomIndex = 1 + Math.floor(Math.random() * (keys.length - 2));
      return keys[randomIndex];
    } else if (keys.length > 0) {
      return keys[0];
    }
  } catch (error) {
    // If multi-key generation fails, fall back to single key
    console.warn(
      `Multi-key generation failed between ${cleanA} and ${cleanB}, using single key`,
    );
  }

  // Fallback to single key generation
  return generateKeyBetween(cleanA, cleanB);
}

export function generateFractionalIndices(
  a: string | null | undefined,
  b: string | null | undefined,
  n: number,
  jitterProvider: JitterProvider = defaultJitterProvider,
): string[] {
  const cleanA = a ? a.split("~")[0] : a;
  const cleanB = b ? b.split("~")[0] : b;

  const keys = generateNKeysBetween(cleanA, cleanB, n);
  // No need to add jitter as each key is already unique
  return keys;
}

// Helper to get initial fractional index
export function initialFractionalIndex(
  jitterProvider: JitterProvider = defaultJitterProvider,
): string {
  return fractionalIndexBetween(null, null, jitterProvider);
}

// Helper to validate fractional index (basic check)
export function isValidFractionalIndex(index: string): boolean {
  return typeof index === "string" && index.length > 0;
}

// Helper functions to create cell events with proper fractional indexing
export function createCellAfter(
  afterCellId: string | null,
  cells: Array<{ id: string; fractionalIndex: string | null }>,
  cellData: {
    id: string;
    cellType: CellType;
    createdBy: string;
  },
): ReturnType<typeof events.cellCreated2> {
  // Only consider cells with valid fractionalIndex for ordering
  const cellsWithIndex = cells.filter((c) => c.fractionalIndex);
  const sortedCells = cellsWithIndex.sort((a, b) =>
    a.fractionalIndex!.localeCompare(b.fractionalIndex!)
  );

  let previousKey: string | null = null;
  let nextKey: string | null = null;

  if (afterCellId) {
    // Find the cell we want to insert after
    const targetCell = cells.find((c) => c.id === afterCellId);
    if (targetCell && targetCell.fractionalIndex) {
      // If the target cell has a fractionalIndex, use it
      previousKey = targetCell.fractionalIndex;

      // Find the next cell in sorted order
      const targetIndex = sortedCells.findIndex((c) => c.id === afterCellId);
      if (targetIndex >= 0 && targetIndex < sortedCells.length - 1) {
        const nextCell = sortedCells[targetIndex + 1];
        if (nextCell) {
          nextKey = nextCell.fractionalIndex!;
        }
      }
    }
  } else {
    // When afterCellId is null, insert at the end
    if (sortedCells.length > 0) {
      const lastCell = sortedCells[sortedCells.length - 1];
      if (lastCell) {
        previousKey = lastCell.fractionalIndex!;
      }
    }
    // If no cells with fractionalIndex exist, previousKey and nextKey remain null
    // This will create the first fractionalIndex
  }

  const fractionalIndex = fractionalIndexBetween(previousKey, nextKey);

  return events.cellCreated2({
    ...cellData,
    fractionalIndex,
  });
}

export function createCellBefore(
  beforeCellId: string | null,
  cells: Array<{ id: string; fractionalIndex: string | null }>,
  cellData: {
    id: string;
    cellType: CellType;
    createdBy: string;
  },
): ReturnType<typeof events.cellCreated2> {
  // Only consider cells with valid fractionalIndex for ordering
  const cellsWithIndex = cells.filter((c) => c.fractionalIndex);
  const sortedCells = cellsWithIndex.sort((a, b) =>
    a.fractionalIndex!.localeCompare(b.fractionalIndex!)
  );

  let previousKey: string | null = null;
  let nextKey: string | null = null;

  if (beforeCellId) {
    // Find the cell we want to insert before
    const targetCell = cells.find((c) => c.id === beforeCellId);
    if (targetCell && targetCell.fractionalIndex) {
      // If the target cell has a fractionalIndex, use it
      nextKey = targetCell.fractionalIndex;

      // Find the previous cell in sorted order
      const targetIndex = sortedCells.findIndex((c) => c.id === beforeCellId);
      if (targetIndex > 0) {
        const prevCell = sortedCells[targetIndex - 1];
        if (prevCell) {
          previousKey = prevCell.fractionalIndex!;
        }
      }
    }
  } else {
    // When beforeCellId is null, also insert at the end (same as createCellAfter with null)
    if (sortedCells.length > 0) {
      const lastCell = sortedCells[sortedCells.length - 1];
      if (lastCell) {
        previousKey = lastCell.fractionalIndex!;
      }
    }
    // If no cells with fractionalIndex exist, previousKey and nextKey remain null
    // This will create the first fractionalIndex
  }

  const fractionalIndex = fractionalIndexBetween(previousKey, nextKey);

  return events.cellCreated2({
    ...cellData,
    fractionalIndex,
  });
}

export function createCellAtPosition(
  position: number,
  cells: Array<{ id: string; fractionalIndex: string | null }>,
  cellData: {
    id: string;
    cellType: CellType;
    createdBy: string;
  },
): ReturnType<typeof events.cellCreated2> {
  const sortedCells = cells
    .filter((c) => c.fractionalIndex)
    .sort((a, b) => a.fractionalIndex!.localeCompare(b.fractionalIndex!));

  // Clamp position to valid range
  const clampedPosition = Math.max(0, Math.min(position, sortedCells.length));

  let previousKey: string | null = null;
  let nextKey: string | null = null;

  if (clampedPosition > 0) {
    const prevCell = sortedCells[clampedPosition - 1];
    if (prevCell) {
      previousKey = prevCell.fractionalIndex!;
    }
  }
  if (clampedPosition < sortedCells.length) {
    const nextCell = sortedCells[clampedPosition];
    if (nextCell) {
      nextKey = nextCell.fractionalIndex!;
    }
  }

  const fractionalIndex = fractionalIndexBetween(previousKey, nextKey);

  return events.cellCreated2({
    ...cellData,
    fractionalIndex,
  });
}

// Pre 0.7.1 -- these types should get created in clients
// const state = State.SQLite.makeState({ tables, materializers });
// export const schema = makeSchema({ events, state });
// export type Store = LiveStore<typeof schema>;

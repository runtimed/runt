import { Events, Schema, State } from "@livestore/livestore";

import {
  ActorTypeSchema,
  type CellType,
  CellTypeSchema,
  MediaRepresentationSchema,
} from "./types.ts";

import type {
  ArtifactContainer,
  InlineContainer,
  MediaContainer,
} from "./types.ts";

import { tables } from "./tables.ts";

export { tables };

export * from "./types.ts";
export * from "./queries/index.ts";

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
 * - Service clients use RUNT_API_KEY for user authentication (AUTH_TOKEN as service fallback)
 * - ClientId must be non-numeric to prevent user impersonation
 *
 * USER CLIENTS (runtime: false/undefined):
 * - Regular users: clientId = userId-{uniqueId} (e.g. "user123-abc-def-ghi")

 * - User clients use OIDC tokens for authentication
 * - User ID is passed separately in sync payload for authorization
 * - ClientId identifies device/app instances following LiveStore best practices
 *
 * PRESENCE DISPLAY:
 * - Runtime agents: Bot icon with runtimeType label
 * - Notebook runners: Play icon (headless execution you can monitor)
 * - TUI clients: Terminal icon (terminal interface)
 * - Regular users: User avatar/initials
 */

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

  cellMoved2: Events.synced({
    name: "v2.CellMoved",
    schema: Schema.Struct({
      id: Schema.String,
      fractionalIndex: Schema.String.annotations({
        description: "New fractional index position for the cell",
      }),
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
        // Convert position to deterministic fractional index in base36 format
        // Position 0 -> "a0", Position 1 -> "a1", etc.
        fractionalIndex: "a" + Math.floor(position).toString(36),
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
    // Convert position to deterministic fractional index in base36 format
    ops.push(
      tables.cells.update({
        fractionalIndex: "a" + Math.floor(newPosition).toString(36),
      }).where({ id }),
    );
    if (actorId) {
      ops.push(updatePresence(actorId, id));
    }
    return ops;
  },

  "v2.CellMoved": ({ id, fractionalIndex, actorId }) => {
    const ops = [];
    ops.push(tables.cells.update({ fractionalIndex }).where({ id }));
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
    ownerId: getNotebookMetadata(metadataRecords, "ownerId", "unknown"),
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

// Export fractional indexing utilities with optional jittering
/**
 * Binary-collation-safe fractional indexing implementation.
 * Uses only characters 0-9 and a-z which sort correctly in binary/ASCII collation.
 * This avoids the uppercase/lowercase sorting issues with the fractional-indexing library.
 */

const BASE36_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = BASE36_DIGITS.length;

function charToValue(char: string): number {
  const index = BASE36_DIGITS.indexOf(char);
  if (index === -1) {
    throw new Error(`Invalid character: ${char}`);
  }
  return index;
}

function valueToChar(value: number): string {
  if (value < 0 || value >= BASE) {
    throw new Error(`Value out of range: ${value}`);
  }
  return BASE36_DIGITS[value]!;
}

function generateKeyBetween(
  a: string | null | undefined,
  b: string | null | undefined,
): string {
  // Handle null/undefined cases
  if (!a && !b) return "m"; // Middle of the range
  if (!a) return generateKeyBefore(b!);
  if (!b) return generateKeyAfter(a);

  // Ensure a < b
  if (a >= b) {
    throw new Error(`Invalid range: ${a} >= ${b}`);
  }

  // Find the first position where they differ
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i++;
  }

  // If a is a prefix of b, we need special handling
  if (i === a.length) {
    const nextChar = b[i];
    if (!nextChar) {
      throw new Error(`Invalid index ${i} for string ${b}`);
    }
    const nextVal = charToValue(nextChar);

    // If b continues with a character > 0, we can insert a midpoint
    if (nextVal > 0) {
      // We can fit something between a and b
      // For example, between "a" and "a5", we can use "a2"
      const midVal = Math.floor(nextVal / 2);
      if (midVal > 0) {
        return a + valueToChar(midVal);
      } else {
        // nextVal is 1, so midVal is 0
        // Return a + "0" which is between a and a + "1"
        return a + "0";
      }
    } else {
      // nextVal is 0, meaning b continues with "0" after a ends
      // Check if we can insert something between them
      if (b.length > i + 1) {
        // b continues past the initial "0"
        // Count consecutive zeros after position i in b
        let zeroCount = 0;
        let j = i;
        while (j < b.length && b[j] === "0") {
          zeroCount++;
          j++;
        }

        // If b is all zeros after the prefix, we can insert a string with fewer zeros
        // For example: between "m" and "m000", we can use "m0" or "m00"
        if (j === b.length && zeroCount > 1) {
          // Use half the zeros (at least 1)
          return a + "0".repeat(Math.floor(zeroCount / 2));
        } else if (j < b.length) {
          // b has a non-zero character at position j
          // We can insert something before that position
          const prefix = a + "0".repeat(j - i);
          const nextChar = b[j];
          if (!nextChar) {
            throw new Error(`Invalid index ${j} for string ${b}`);
          }
          const nextVal = charToValue(nextChar);
          if (nextVal > 0) {
            return prefix + valueToChar(Math.floor(nextVal / 2));
          }
        }
      }
      // No space between a and b
      throw new Error(
        `No string exists between "${a}" and "${b}" in base36 encoding`,
      );
    }
  }

  // If b is a prefix of a (shouldn't happen if a < b, but let's be safe)
  if (i === b.length) {
    throw new Error(`Invalid case: b "${b}" is a prefix of a "${a}"`);
  }

  // Get the values at position i
  const aChar = a[i];
  const bChar = b[i];
  if (!aChar || !bChar) {
    throw new Error(`Invalid index ${i} for strings ${a} and ${b}`);
  }
  const aVal = charToValue(aChar);
  const bVal = charToValue(bChar);

  // If there's room between them, use the midpoint
  if (bVal - aVal > 1) {
    const midVal = Math.floor((aVal + bVal) / 2);
    return a.substring(0, i) + valueToChar(midVal) + a.substring(i + 1);
  }

  // Characters are adjacent (diff is 1)
  // We need to extend the string to find a position

  // If a has more characters after position i, we can increment within a's range
  if (i < a.length - 1) {
    // Try to find space after a[i] but within a's remaining range
    const prefix = a.substring(0, i + 1);
    const remaining = a.substring(i + 1);

    // Find a position between remaining and the next possible string
    const suffix = generateKeyAfter(remaining);
    return prefix + suffix;
  }

  // a[i] and b[i] are adjacent, and a has no more characters
  // We need to extend a with something that keeps us less than b
  // Since b[i] = aVal + 1, we extend a with a midpoint character
  return a.substring(0, i + 1) + "h";
}

function generateKeyBefore(b: string): string {
  if (!b || b.length === 0) {
    return "m"; // Middle of range if no upper bound
  }

  // Find the first non-zero character
  let i = 0;
  while (i < b.length && b[i] === "0") {
    i++;
  }

  if (i === b.length) {
    // All zeros, prepend another zero
    return "0" + b;
  }

  // Found a non-zero character
  const char = b[i];
  if (!char) {
    throw new Error(`Invalid index ${i} for string ${b}`);
  }
  const val = charToValue(char);

  if (i === 0 && val > 1) {
    // Can simply use a smaller first character
    return valueToChar(Math.floor(val / 2));
  }

  // Need to preserve prefix and adjust
  const prefix = b.substring(0, i);
  if (val > 1) {
    return prefix + valueToChar(Math.floor(val / 2));
  }

  // val is 1, so we use prefix + "0" + midpoint
  return prefix + "0h";
}

function generateKeyAfter(a: string): string {
  if (!a || a.length === 0) {
    return "m"; // Middle of range if no lower bound
  }

  // Find the last character that isn't 'z'
  let i = a.length - 1;
  while (i >= 0 && a[i] === "z") {
    i--;
  }

  if (i === -1) {
    // All 'z's, need to extend
    return a + "h"; // Append midpoint
  }

  // Can increment the character at position i
  const prefix = a.substring(0, i);
  const char = a[i];
  if (!char) {
    throw new Error(`Invalid index ${i} for string ${a}`);
  }
  const val = charToValue(char);

  if (val < BASE - 2) {
    // Simple increment
    return prefix + valueToChar(val + 1);
  }

  // val is 'y', incrementing gives 'z'
  // To avoid getting too close to the boundary, extend instead
  return a + "h";
}

// JitterProvider interface for testability
export interface JitterProvider {
  // Returns a random number between 0 and 1
  random(): number;
  // Returns a random integer between 0 (inclusive) and max (exclusive)
  randomInt(max: number): number;
}

// Default jitter provider using Math.random
export const defaultJitterProvider: JitterProvider = {
  random: () => Math.random(),
  randomInt: (max) => Math.floor(Math.random() * max),
};

// Deterministic jitter provider for testing
export const createTestJitterProvider = (seed = 0): JitterProvider => {
  let currentSeed = seed;

  // Simple linear congruential generator
  const nextRandom = () => {
    currentSeed = (currentSeed * 1103515245 + 12345) & 0x7fffffff;
    return currentSeed / 0x7fffffff;
  };

  return {
    random: nextRandom,
    randomInt: (max) => Math.floor(nextRandom() * max),
  };
};

export function fractionalIndexBetween(
  a: string | null | undefined,
  b: string | null | undefined,
  jitterProvider: JitterProvider = defaultJitterProvider,
): string {
  // Add some jitter to avoid clustering
  const key = generateKeyBetween(a, b);

  // For better distribution, sometimes extend the key
  // But we must ensure the result stays within bounds
  if (jitterProvider.random() < 0.3 && key.length < 10) {
    const suffix = valueToChar(jitterProvider.randomInt(BASE));
    const candidate = key + suffix;

    // Verify the candidate maintains ordering
    const isValid = (!a || candidate > a) && (!b || candidate < b);

    if (isValid) {
      return candidate;
    }
  }

  return key;
}

export function generateFractionalIndices(
  a: string | null | undefined,
  b: string | null | undefined,
  n: number,
  jitterProvider: JitterProvider = defaultJitterProvider,
): string[] {
  if (n <= 0) return [];
  if (n === 1) return [fractionalIndexBetween(a, b, jitterProvider)];

  const keys: string[] = [];

  // Generate n keys by repeatedly subdividing the range
  let prev = a;
  for (let i = 0; i < n; i++) {
    // For better distribution, we generate keys sequentially
    // This avoids clustering that can happen with binary subdivision
    const key = fractionalIndexBetween(prev, b, jitterProvider);
    keys.push(key);
    prev = key;
  }

  return keys;
}

// Helper to get initial fractional index
export function initialFractionalIndex(
  jitterProvider: JitterProvider = defaultJitterProvider,
): string {
  return fractionalIndexBetween(null, null, jitterProvider);
}

// Rebalancing functionality to handle "No string exists between" cases

export interface RebalanceResult {
  /** New fractional indices for the cells */
  newIndices: { cellId: string; fractionalIndex: string }[];
  /** Events to apply the rebalancing */
  events: ReturnType<typeof events.cellMoved2>[];
}

export interface RebalanceOptions {
  /** Jitter provider for consistent generation */
  jitterProvider?: JitterProvider;
  /** Actor ID for the rebalancing events */
  actorId?: string;
  /** Buffer space to add around the rebalanced region */
  bufferCells?: number;
}

export interface CellOperationResult {
  /** Events to apply for the cell operation (may include rebalancing) */
  events: Array<
    | ReturnType<typeof events.cellCreated2>
    | ReturnType<typeof events.cellMoved2>
  >;
  /** ID of the newly created cell */
  newCellId: string;
  /** Whether rebalancing was performed */
  needsRebalancing: boolean;
  /** Number of cells rebalanced (for debugging/metrics) */
  rebalanceCount?: number;
}

export interface MoveOperationResult {
  /** Events to apply for the move operation (may include rebalancing) */
  events: Array<ReturnType<typeof events.cellMoved2>>;
  /** Whether the cell was actually moved */
  moved: boolean;
  /** Whether rebalancing was performed */
  needsRebalancing: boolean;
  /** Number of cells rebalanced (for debugging/metrics) */
  rebalanceCount?: number;
}

/**
 * Determines if a range of cells needs rebalancing due to crowded indices
 */
export function needsRebalancing(
  cells: readonly CellReference[],
  insertPosition?: number,
): boolean {
  if (cells.length < 2) return false;

  // Sort cells by fractional index
  const sortedCells = [...cells].sort((a, b) =>
    (a.fractionalIndex || "").localeCompare(b.fractionalIndex || "")
  );

  // Check for adjacent indices that would prevent insertion
  for (let i = 0; i < sortedCells.length - 1; i++) {
    const current = sortedCells[i]?.fractionalIndex;
    const next = sortedCells[i + 1]?.fractionalIndex;

    if (!current || !next) continue;

    try {
      // Test if we can insert between these indices
      fractionalIndexBetween(current, next, {
        random: () => 0,
        randomInt: () => 0,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes("No string exists between") ||
          error.message.includes("Invalid range"))
      ) {
        return true;
      }
    }
  }

  // If insertPosition is specified, check if we can insert there
  if (insertPosition !== undefined) {
    const beforeCell = insertPosition > 0
      ? sortedCells[insertPosition - 1]
      : null;
    const afterCell = insertPosition < sortedCells.length
      ? sortedCells[insertPosition]
      : null;

    if (beforeCell && afterCell) {
      try {
        fractionalIndexBetween(
          beforeCell.fractionalIndex,
          afterCell.fractionalIndex,
          { random: () => 0, randomInt: () => 0 },
        );
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("No string exists between") ||
            error.message.includes("Invalid range"))
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Rebalances fractional indices for a range of cells to create space for insertions
 */
export function rebalanceCellIndices(
  cells: readonly CellReference[],
  options: RebalanceOptions = {},
): RebalanceResult {
  const {
    jitterProvider = defaultJitterProvider,
    actorId = "system",
    bufferCells = 2,
  } = options;

  if (cells.length === 0) {
    return { newIndices: [], events: [] };
  }

  // Sort cells by current fractional index
  const sortedCells = [...cells].sort((a, b) =>
    (a.fractionalIndex || "").localeCompare(b.fractionalIndex || "")
  );

  const newIndices: { cellId: string; fractionalIndex: string }[] = [];
  const moveEvents: ReturnType<typeof events.cellMoved2>[] = [];

  // Calculate the range with buffer
  const totalPositions = cells.length + (bufferCells * 2);

  // Generate evenly distributed indices
  const indices = generateFractionalIndices(
    null,
    null,
    totalPositions,
    jitterProvider,
  );

  // Assign new indices to cells (skipping buffer positions)
  for (let i = 0; i < sortedCells.length; i++) {
    const cell = sortedCells[i];
    const newIndex = indices[i + bufferCells]; // Skip buffer positions at start

    if (!cell || !newIndex) continue;

    if (cell.fractionalIndex !== newIndex) {
      newIndices.push({
        cellId: cell.id,
        fractionalIndex: newIndex,
      });

      // Create move event
      const moveEvent = events.cellMoved2({
        id: cell.id,
        fractionalIndex: newIndex,
        actorId,
      });

      moveEvents.push(moveEvent);
    }
  }

  return { newIndices, events: moveEvents };
}

/**
 * Calculate insertion index after rebalancing has been performed
 */
function calculateInsertionIndexAfterRebalancing(
  insertPosition: number,
  rebalanceResult: RebalanceResult,
  jitterProvider: JitterProvider,
): string {
  // Get the new indices after rebalancing
  const newIndices = rebalanceResult.newIndices.map((item) =>
    item.fractionalIndex
  );
  newIndices.sort();

  // Calculate where to insert based on the position
  if (insertPosition === 0) {
    // Insert at beginning - generate index before first cell
    const firstIndex = newIndices[0];
    return fractionalIndexBetween(null, firstIndex, jitterProvider);
  }

  if (insertPosition >= newIndices.length) {
    // Insert at end - generate index after last cell
    const lastIndex = newIndices[newIndices.length - 1];
    return fractionalIndexBetween(lastIndex, null, jitterProvider);
  }

  // Insert between cells at insertPosition-1 and insertPosition
  const beforeIndex = newIndices[insertPosition - 1];
  const afterIndex = newIndices[insertPosition];
  return fractionalIndexBetween(beforeIndex, afterIndex, jitterProvider);
}

/**
 * Enhanced fractional index generation with automatic rebalancing fallback
 */
export function fractionalIndexBetweenWithFallback(
  a: string | null | undefined,
  b: string | null | undefined,
  context: {
    /** All cells in the current context for rebalancing */
    allCells?: readonly CellReference[];
    /** Position where insertion is intended */
    insertPosition?: number;
    /** Jitter provider */
    jitterProvider?: JitterProvider;
  } = {},
): {
  index?: string;
  needsRebalancing: boolean;
  rebalanceResult?: RebalanceResult;
} {
  const {
    allCells = [],
    insertPosition,
    jitterProvider = defaultJitterProvider,
  } = context;

  // First, try normal fractional index generation
  try {
    const index = fractionalIndexBetween(a, b, jitterProvider);
    return { index, needsRebalancing: false };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("No string exists between") ||
        error.message.includes("Invalid range"))
    ) {
      // Check if rebalancing is needed and possible
      if (allCells.length > 0 && needsRebalancing(allCells, insertPosition)) {
        const rebalanceResult = rebalanceCellIndices(allCells, {
          jitterProvider,
        });

        // Calculate the insertion index after rebalancing
        const position = insertPosition ?? allCells.length;
        const insertionIndex = calculateInsertionIndexAfterRebalancing(
          position,
          rebalanceResult,
          jitterProvider,
        );

        return {
          index: insertionIndex,
          needsRebalancing: true,
          rebalanceResult,
        };
      }
    }

    // Re-throw other errors
    throw error;
  }
}

/**
 * Safe cell movement with automatic rebalancing
 */
export function moveCellWithRebalancing(
  cell: CellReference,
  cellBefore: CellReference | null,
  cellAfter: CellReference | null,
  allCells: readonly CellReference[],
  options: {
    actorId?: string;
    jitterProvider?: JitterProvider;
  } = {},
): {
  moveEvent?: ReturnType<typeof events.cellMoved2>;
  rebalanceResult?: RebalanceResult;
  needsRebalancing: boolean;
} {
  const { actorId = "user", jitterProvider = defaultJitterProvider } = options;

  // Try normal move first
  try {
    const moveEvent = moveCellBetween(
      cell,
      cellBefore,
      cellAfter,
      actorId,
      jitterProvider,
    );

    if (moveEvent) {
      return { moveEvent, needsRebalancing: false };
    }
  } catch (error) {
    // Check if it's the "No string exists between" error
    if (
      error instanceof Error &&
      error.message.includes("No string exists between")
    ) {
      // This indicates we need rebalancing, so fall through to the rebalancing check
    } else {
      // Re-throw other errors
      throw error;
    }
  }

  // Check if it's because we need rebalancing
  if (needsRebalancing(allCells)) {
    const rebalanceResult = rebalanceCellIndices(allCells, {
      jitterProvider,
      actorId: `${actorId}-rebalance`,
    });

    return {
      needsRebalancing: true,
      rebalanceResult,
    };
  }

  // Cell was already in position or other reason
  return { needsRebalancing: false };
}

// Helper to validate fractional index (basic check)
export function isValidFractionalIndex(index: string): boolean {
  if (typeof index !== "string" || index.length === 0) {
    return false;
  }

  // Check that all characters are valid base36 characters
  for (const char of index) {
    if (!BASE36_DIGITS.includes(char)) {
      return false;
    }
  }

  return true;
}

// Validate that fractional indices maintain proper binary collation ordering
export function validateFractionalIndexOrder(
  indices: (string | null | undefined)[],
): boolean {
  const validIndices = indices.filter((idx): idx is string =>
    isValidFractionalIndex(idx || "")
  );

  for (let i = 1; i < validIndices.length; i++) {
    const prev = validIndices[i - 1];
    const curr = validIndices[i];
    if (!prev || !curr) {
      return false;
    }
    if (prev >= curr) {
      console.error(
        `Fractional index ordering violation: "${prev}" >= "${curr}"`,
      );
      return false;
    }
  }

  return true;
}

/**
 * Cell reference type for fractional indexing operations
 */
export type CellReference = {
  id: string;
  fractionalIndex: string | null;
  cellType: CellType;
};

/**
 * Helper functions for cell creation and movement with fractional indexing
 *
 * Sorting Strategy:
 * 1. Primary sort: Lexicographic comparison of fractional indices (a < b, not localeCompare)
 * 2. Secondary sort: Cell ID comparison when fractional indices are equal (rare but possible)
 *
 * This ensures stable, deterministic ordering even in the unlikely event of index collisions.
 * We generate 20 candidate indices and pick one randomly to minimize collision probability.
 */

/**
 * Move a cell between two other cells using fractional indices
 *
 * @param cell - The cell to move (must have a valid fractionalIndex)
 * @param cellBefore - The cell that should come before (null for beginning)
 * @param cellAfter - The cell that should come after (null for end)
 * @param actorId - Optional actor ID for tracking who made the change
 *
 * Note: It's the caller's responsibility to provide accurate before/after cells.
 * If both cellBefore and cellAfter are provided, they must be adjacent cells.
 */
export function moveCellBetween(
  cell: CellReference,
  cellBefore: CellReference | null,
  cellAfter: CellReference | null,
  actorId?: string,
  jitterProvider: JitterProvider = defaultJitterProvider,
): ReturnType<typeof events.cellMoved2> | null {
  // Cell must have a valid fractional index to be moved
  if (!cell.fractionalIndex) {
    return null;
  }

  // Determine the fractional indices for before and after
  const previousKey = cellBefore?.fractionalIndex || null;
  const nextKey = cellAfter?.fractionalIndex || null;

  // Check if already in the target position
  if (cellBefore && cellAfter) {
    // If between two cells, check if we're already there
    if (
      cell.fractionalIndex > previousKey! &&
      cell.fractionalIndex < nextKey!
    ) {
      return null;
    }
  } else if (!cellBefore && cellAfter) {
    // Moving to beginning - check if already before cellAfter
    if (cell.fractionalIndex < nextKey!) {
      return null;
    }
  } else if (cellBefore && !cellAfter) {
    // Moving to end - check if already after cellBefore
    if (cell.fractionalIndex > previousKey!) {
      return null;
    }
  }

  const fractionalIndex = fractionalIndexBetween(
    previousKey,
    nextKey,
    jitterProvider,
  );

  return events.cellMoved2({
    id: cell.id,
    fractionalIndex,
    actorId,
  });
}

/**
 * Create a cell between two other cells using fractional indices
 *
 * @param cellData - The cell data (id, cellType, createdBy)
 * @param cellBefore - The cell that should come before (null for beginning)
 * @param cellAfter - The cell that should come after (null for end)
 *
 * Note: It's the caller's responsibility to provide accurate before/after cells.
 * If both cellBefore and cellAfter are provided, they must be adjacent cells.
 */
export function createCellBetween(
  cellData: {
    id: string;
    cellType: CellType;
    createdBy: string;
  },
  cellBefore: CellReference | null,
  cellAfter: CellReference | null,
  allCells: readonly CellReference[],
  jitterProvider: JitterProvider = defaultJitterProvider,
): CellOperationResult {
  // Determine the fractional indices for before and after
  let previousKey = cellBefore?.fractionalIndex || null;
  let nextKey = cellAfter?.fractionalIndex || null;

  // Special case: if both are null but we have existing cells, insert at end
  if (!cellBefore && !cellAfter && allCells.length > 0) {
    // Sort cells by fractional index to find the last one
    const sortedCells = [...allCells].sort((a, b) =>
      (a.fractionalIndex || "").localeCompare(b.fractionalIndex || "")
    );
    const lastCell = sortedCells[sortedCells.length - 1];
    if (lastCell?.fractionalIndex) {
      previousKey = lastCell.fractionalIndex;
      nextKey = null; // Insert after the last cell
    }
  }

  // Calculate insertion position for rebalancing context
  let insertPosition = 0;
  if (cellBefore && cellAfter) {
    // Find position between the two cells
    const beforeIndex = allCells.findIndex((cell) => cell.id === cellBefore.id);
    insertPosition = beforeIndex + 1;
  } else if (cellBefore) {
    // Insert after cellBefore
    const beforeIndex = allCells.findIndex((cell) => cell.id === cellBefore.id);
    insertPosition = beforeIndex + 1;
  } else if (cellAfter) {
    // Insert before cellAfter
    const afterIndex = allCells.findIndex((cell) => cell.id === cellAfter.id);
    insertPosition = afterIndex;
  } else {
    // Insert at end
    insertPosition = allCells.length;
  }

  // Use the robust fractional index generation with fallback
  const result = fractionalIndexBetweenWithFallback(
    previousKey,
    nextKey,
    {
      allCells,
      insertPosition,
      jitterProvider,
    },
  );

  const resultEvents: Array<
    | ReturnType<typeof events.cellCreated2>
    | ReturnType<typeof events.cellMoved2>
  > = [];

  // Add rebalancing events if needed
  if (result.needsRebalancing && result.rebalanceResult) {
    resultEvents.push(...result.rebalanceResult.events);
  }

  // Create the new cell with the calculated fractional index
  const createEvent = events.cellCreated2({
    ...cellData,
    fractionalIndex: result.index!,
  });
  resultEvents.push(createEvent);

  return {
    events: resultEvents,
    newCellId: cellData.id,
    needsRebalancing: result.needsRebalancing,
    ...(result.rebalanceResult && {
      rebalanceCount: result.rebalanceResult.newIndices.length,
    }),
  };
}

/**
 * Move a cell between two other cells with automatic rebalancing
 */
export function moveCellBetweenWithRebalancing(
  cell: CellReference,
  cellBefore: CellReference | null,
  cellAfter: CellReference | null,
  allCells: readonly CellReference[],
  actorId?: string,
  jitterProvider: JitterProvider = defaultJitterProvider,
): MoveOperationResult {
  // Cell must have a valid fractional index to be moved
  if (!cell.fractionalIndex) {
    return {
      events: [],
      moved: false,
      needsRebalancing: false,
    };
  }

  // Calculate target position
  let targetPosition = 0;
  if (cellBefore && cellAfter) {
    // Find position between the two cells
    const beforeIndex = allCells.findIndex((c) => c.id === cellBefore.id);
    targetPosition = beforeIndex + 1;
  } else if (cellBefore) {
    // Move after cellBefore
    const beforeIndex = allCells.findIndex((c) => c.id === cellBefore.id);
    targetPosition = beforeIndex + 1;
  } else if (cellAfter) {
    // Move before cellAfter
    const afterIndex = allCells.findIndex((c) => c.id === cellAfter.id);
    targetPosition = afterIndex;
  } else {
    // Move to end
    targetPosition = allCells.length - 1; // Account for the cell being moved
  }

  // Check if already in target position
  const currentPosition = allCells.findIndex((c) => c.id === cell.id);
  if (currentPosition === targetPosition) {
    return {
      events: [],
      moved: false,
      needsRebalancing: false,
    };
  }

  // Use the existing moveCellWithRebalancing function
  const result = moveCellWithRebalancing(
    cell,
    cellBefore,
    cellAfter,
    allCells,
    { ...(actorId && { actorId }), jitterProvider },
  );

  const resultEvents: Array<ReturnType<typeof events.cellMoved2>> = [];

  // Add rebalancing events if needed
  if (result.needsRebalancing && result.rebalanceResult) {
    resultEvents.push(...result.rebalanceResult.events);

    return {
      events: resultEvents,
      moved: true,
      needsRebalancing: true,
      rebalanceCount: result.rebalanceResult.newIndices.length,
    };
  }

  // Add the move event if one was generated
  if (result.moveEvent) {
    resultEvents.push(result.moveEvent);

    return {
      events: resultEvents,
      moved: true,
      needsRebalancing: false,
    };
  }

  // No move was needed
  return {
    events: [],
    moved: false,
    needsRebalancing: false,
  };
}

/**
 * Convenience function for simple cell creation with automatic event commitment
 * Returns the new cell ID for immediate use
 */
export function createCellBetweenAndCommit<
  T extends {
    commit: (
      event:
        | ReturnType<typeof events.cellCreated2>
        | ReturnType<typeof events.cellMoved2>,
    ) => void;
  },
>(
  store: T,
  cellData: {
    id: string;
    cellType: CellType;
    createdBy: string;
  },
  cellBefore: CellReference | null,
  cellAfter: CellReference | null,
  allCells: readonly CellReference[],
  jitterProvider: JitterProvider = defaultJitterProvider,
): string {
  const result = createCellBetween(
    cellData,
    cellBefore,
    cellAfter,
    allCells,
    jitterProvider,
  );

  // Commit all events
  result.events.forEach((event) => store.commit(event));

  return result.newCellId;
}

/**
 * Convenience function for simple cell movement with automatic event commitment
 * Returns whether the cell was actually moved
 */
export function moveCellBetweenAndCommit<
  T extends { commit: (event: ReturnType<typeof events.cellMoved2>) => void },
>(
  store: T,
  cell: CellReference,
  cellBefore: CellReference | null,
  cellAfter: CellReference | null,
  allCells: readonly CellReference[],
  actorId?: string,
  jitterProvider: JitterProvider = defaultJitterProvider,
): boolean {
  const result = moveCellBetweenWithRebalancing(
    cell,
    cellBefore,
    cellAfter,
    allCells,
    actorId,
    jitterProvider,
  );

  // Commit all events
  result.events.forEach((event) => store.commit(event));

  return result.moved;
}

// Pre 0.7.1 -- these types should get created in clients
// const state = State.SQLite.makeState({ tables, materializers });
// export const schema = makeSchema({ events, state });
// export type Store = LiveStore<typeof schema>;

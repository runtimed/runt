// Core RuntimeAgent class - platform-agnostic runtime execution logic
//
// This class plugs into an existing LiveStore instance rather than creating its own,
// enabling browser usage where the store is shared with a React UI.

import { queryDb, type Store } from "npm:@livestore/livestore";
import {
  events,
  type ImageMimeType,
  isImageMimeType,
  type MediaContainer,
  tables,
} from "@runt/schema";
import { createLogger } from "./logging.ts";
import { ArtifactClient } from "./artifact-client.ts";
import type {
  ArtifactSubmissionOptions,
  CancellationHandler,
  CellData,
  ExecutionContext,
  ExecutionHandler,
  ExecutionQueueData,
  ExecutionResult,
  IArtifactClient,
  RawOutputData,
  RuntimeAgentEventHandlers,
  RuntimeAgentOptions,
  RuntimeCapabilities,
  RuntimeSessionData,
} from "./types.ts";

/**
 * Core RuntimeAgent class providing LiveStore integration and execution management
 *
 * This agent plugs into an existing LiveStore instance, making it suitable for
 * browser usage where the store is shared with a React UI.
 */
export class RuntimeAgent {
  public readonly sessionId: string;
  private logger: ReturnType<typeof createLogger>;
  private isShuttingDown = false;
  private processedExecutions = new Set<string>();
  private subscriptions: (() => void)[] = [];
  private activeExecutions = new Map<string, AbortController>();
  private cancellationHandlers: CancellationHandler[] = [];
  private artifactClient: IArtifactClient;

  constructor(
    public readonly store: Store<any>, // TODO: proper schema typing
    private capabilities: RuntimeCapabilities,
    public readonly options: RuntimeAgentOptions,
    private handlers: RuntimeAgentEventHandlers = {},
    artifactClient?: IArtifactClient,
  ) {
    // Generate session ID if not provided
    this.sessionId = options.sessionId ||
      `${options.runtimeType}-${options.runtimeId}-${Date.now()}-${
        Math.random().toString(36).substring(2, 15)
      }`;

    // Use provided artifact client or create default
    this.artifactClient = artifactClient || new ArtifactClient();

    this.logger = createLogger(`${options.runtimeType}-agent`, {
      context: {
        runtimeId: options.runtimeId,
        runtimeType: options.runtimeType,
        sessionId: this.sessionId,
        clientId: options.clientId,
      },
    });
  }

  /**
   * Start the runtime agent - registers with LiveStore and begins processing
   */
  async start(): Promise<void> {
    try {
      await this.handlers.onStartup?.(this.options);

      this.logger.info("Starting runtime agent", {
        runtimeId: this.options.runtimeId,
        runtimeType: this.options.runtimeType,
        sessionId: this.sessionId,
        clientId: this.options.clientId,
      });

      // Displace any existing active sessions for this notebook
      const existingSessions = this.store.query(
        tables.runtimeSessions.select().where({ isActive: true }),
      );

      for (const session of existingSessions) {
        this.store.commit(events.runtimeSessionTerminated({
          sessionId: session.sessionId,
          reason: "displaced",
        }));
      }

      // Start session with capabilities
      this.store.commit(events.runtimeSessionStarted({
        sessionId: this.sessionId,
        runtimeId: this.options.runtimeId,
        runtimeType: this.options.runtimeType,
        capabilities: this.capabilities,
      }));

      // Set up reactive queries and subscriptions
      this.setupSubscriptions();

      // Mark session as ready
      this.store.commit(events.runtimeSessionStatusChanged({
        sessionId: this.sessionId,
        status: "ready",
      }));

      await this.handlers.onConnected?.();
      this.logger.info("Runtime agent connected and ready");
    } catch (error) {
      this.logger.error("Failed to start runtime agent", error);
      await this.handlers.onDisconnected?.(error as Error);
      throw error;
    }
  }

  /**
   * Shutdown the runtime agent and clean up resources
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    this.logger.info("Runtime agent shutting down", {
      runtimeId: this.options.runtimeId,
      sessionId: this.sessionId,
    });

    try {
      await this.handlers.onShutdown?.();

      // Unsubscribe from all reactive queries
      this.subscriptions.forEach((unsubscribe) => unsubscribe());
      this.subscriptions = [];

      // Cancel active executions
      for (const controller of this.activeExecutions.values()) {
        controller.abort();
      }
      this.activeExecutions.clear();

      // Mark session as terminated
      try {
        this.store.commit(events.runtimeSessionTerminated({
          sessionId: this.sessionId,
          reason: "shutdown",
        }));
      } catch (error) {
        this.logger.error("Failed to mark session as terminated", error);
      }
    } catch (error) {
      this.logger.error("Error during shutdown", error, {
        runtimeId: this.options.runtimeId,
        sessionId: this.sessionId,
      });
    }

    this.logger.info("Runtime agent shutdown complete");
  }

  /**
   * Register an execution handler for processing cells
   */
  onExecution(handler: ExecutionHandler): void {
    this.executionHandler = handler;
  }

  /**
   * Register a cancellation handler
   */
  onCancellation(handler: CancellationHandler): void {
    this.cancellationHandlers.push(handler);
  }

  private executionHandler: ExecutionHandler = async (context) => {
    // Default handler - just echo the input
    return {
      success: true,
      data: {
        "text/plain": context.cell.source || "",
      },
    };
  };

  /**
   * Set up reactive queries for execution management
   */
  private setupSubscriptions(): void {
    // Watch for work assigned to this specific runtime
    const assignedWorkQuery$ = queryDb(
      tables.executionQueue.select()
        .where({
          status: "assigned",
          assignedRuntimeSession: this.sessionId,
        }),
      {
        label: "assignedWork",
        deps: [this.sessionId],
      },
    );

    // Watch for pending work to claim
    const pendingWorkQuery$ = queryDb(
      tables.executionQueue.select()
        .where({ status: "pending" }),
      {
        label: "pendingWork",
      },
    );

    // Watch for active runtimes
    const activeRuntimesQuery$ = queryDb(
      tables.runtimeSessions.select()
        .where({ isActive: true }),
      {
        label: "activeRuntimes",
      },
    );

    // Subscribe to assigned work
    const assignedWorkSub = this.store.subscribe(
      assignedWorkQuery$,
      {
        onUpdate: (entries: readonly ExecutionQueueData[]) => {
          if (this.isShuttingDown) return;

          setTimeout(async () => {
            for (const queueEntry of entries) {
              if (this.processedExecutions.has(queueEntry.id)) {
                continue;
              }

              this.processedExecutions.add(queueEntry.id);

              try {
                await this.processExecution(queueEntry);
              } catch (error) {
                this.logger.error("Error processing execution", error, {
                  executionId: queueEntry.id,
                  cellId: queueEntry.cellId,
                });
              }
            }
          }, 0);
        },
      },
    );

    // Subscribe to pending work
    const pendingWorkSub = this.store.subscribe(
      pendingWorkQuery$,
      {
        onUpdate: (entries: readonly ExecutionQueueData[]) => {
          if (this.isShuttingDown) return;

          setTimeout(() => {
            let activeRuntimes: readonly RuntimeSessionData[] = [];
            let ourRuntime: RuntimeSessionData | undefined;

            try {
              activeRuntimes = this.store.query(activeRuntimesQuery$);
              ourRuntime = activeRuntimes.find((r: RuntimeSessionData) =>
                r.sessionId === this.sessionId
              );
            } catch (error) {
              this.logger.debug("LiveStore query failed for active runtimes", {
                error: error instanceof Error ? error.message : String(error),
                sessionId: this.sessionId,
              });
              return;
            }

            if (!ourRuntime) return;

            // Try to claim first pending execution
            const firstPending = entries[0];
            if (firstPending && firstPending.status === "pending") {
              this.store.commit(events.executionAssigned({
                queueId: firstPending.id,
                runtimeSessionId: this.sessionId,
              }));
            }
          }, 0);
        },
      },
    );

    // Watch for cancelled executions
    const cancelledWorkQuery$ = queryDb(
      tables.executionQueue.select()
        .where({ status: "cancelled" }),
      {
        label: "cancelledWork",
      },
    );

    const cancelledWorkSub = this.store.subscribe(
      cancelledWorkQuery$,
      {
        onUpdate: (entries: readonly ExecutionQueueData[]) => {
          if (this.isShuttingDown) return;

          for (const entry of entries) {
            this.handleCancellation(entry.id, entry.cellId, "user_requested");
          }
        },
      },
    );

    // Store subscriptions for cleanup
    this.subscriptions.push(
      assignedWorkSub,
      pendingWorkSub,
      cancelledWorkSub,
    );
  }

  /**
   * Handle cancellation events
   */
  private handleCancellation(
    queueId: string,
    cellId: string,
    reason: string,
  ): void {
    const controller = this.activeExecutions.get(queueId);
    if (controller) {
      this.logger.debug("Cancelling execution", {
        queueId,
        cellId,
        reason,
      });
      controller.abort();
      this.activeExecutions.delete(queueId);

      // Call registered cancellation handlers
      this.cancellationHandlers.forEach((handler) => {
        try {
          handler(queueId, cellId, reason);
        } catch (error) {
          this.logger.error("Cancellation handler error", error);
        }
      });
    }
  }

  /**
   * Process a single execution request
   */
  private async processExecution(
    queueEntry: ExecutionQueueData,
  ): Promise<void> {
    this.logger.debug("Processing execution", {
      executionId: queueEntry.id,
      cellId: queueEntry.cellId,
    });

    // Create AbortController for this execution
    const controller = new AbortController();
    this.activeExecutions.set(queueEntry.id, controller);

    const executionStartTime = new Date();

    // Get cell data
    let cell: CellData;
    try {
      const cells = this.store.query(
        tables.cells.select().where({ id: queueEntry.cellId }),
      );
      cell = cells[0] as CellData;
    } catch (error) {
      this.logger.debug("LiveStore query failed for cell data", {
        error: error instanceof Error ? error.message : String(error),
        cellId: queueEntry.cellId,
      });
      this.activeExecutions.delete(queueEntry.id);
      throw new Error(
        `Failed to query cell ${queueEntry.cellId}: LiveStore error`,
      );
    }

    if (!cell) {
      this.activeExecutions.delete(queueEntry.id);
      throw new Error(`Cell ${queueEntry.cellId} not found`);
    }

    // Track output position for proper ordering
    let outputPosition = 0;

    // Create execution context
    const context: ExecutionContext = {
      cell,
      queueEntry,
      store: this.store,
      sessionId: this.sessionId,
      runtimeId: this.options.runtimeId,
      abortSignal: controller.signal,
      checkCancellation: () => {
        if (controller.signal.aborted) {
          throw new Error("Execution cancelled");
        }
      },

      // Output emission methods for real-time streaming
      stdout: (text: string) => {
        if (text) {
          this.store.commit(events.terminalOutputAdded({
            id: crypto.randomUUID(),
            cellId: cell.id,
            position: outputPosition++,
            content: {
              type: "inline",
              data: text,
            },
            streamName: "stdout",
          }));
        }
      },

      stderr: (text: string) => {
        if (text) {
          this.store.commit(events.terminalOutputAdded({
            id: crypto.randomUUID(),
            cellId: cell.id,
            position: outputPosition++,
            content: {
              type: "inline",
              data: text,
            },
            streamName: "stderr",
          }));
        }
      },

      display: async (
        data: RawOutputData,
        metadata?: Record<string, unknown>,
        displayId?: string,
      ) => {
        // Convert raw data to MediaContainer representations
        const representations: Record<string, MediaContainer> = {};

        for (const [mimeType, content] of Object.entries(data)) {
          // Process images with basic handling (no size-based artifacting for core)
          if (isImageMimeType(mimeType)) {
            representations[mimeType] = await this.processImageContent(
              mimeType,
              content,
              metadata?.[mimeType] as Record<string, unknown>,
            );
          } else {
            representations[mimeType] = {
              type: "inline",
              data: content,
              metadata: metadata?.[mimeType] as Record<string, unknown>,
            };
          }
        }

        this.store.commit(events.multimediaDisplayOutputAdded({
          id: crypto.randomUUID(),
          cellId: cell.id,
          position: outputPosition++,
          representations,
          displayId,
        }));
      },

      updateDisplay: async (
        displayId: string,
        data: RawOutputData,
        metadata?: Record<string, unknown>,
      ) => {
        const representations: Record<string, MediaContainer> = {};

        for (const [mimeType, content] of Object.entries(data)) {
          if (isImageMimeType(mimeType)) {
            representations[mimeType] = await this.processImageContent(
              mimeType,
              content,
              metadata?.[mimeType] as Record<string, unknown>,
            );
          } else {
            representations[mimeType] = {
              type: "inline",
              data: content,
              metadata: metadata?.[mimeType] as Record<string, unknown>,
            };
          }
        }

        this.store.commit(events.multimediaDisplayOutputUpdated({
          displayId,
          representations,
        }));
      },

      result: async (
        data: RawOutputData,
        metadata?: Record<string, unknown>,
      ) => {
        const representations: Record<string, MediaContainer> = {};

        for (const [mimeType, content] of Object.entries(data)) {
          if (isImageMimeType(mimeType)) {
            representations[mimeType] = await this.processImageContent(
              mimeType,
              content,
              metadata?.[mimeType] as Record<string, unknown>,
            );
          } else {
            representations[mimeType] = {
              type: "inline",
              data: content,
              metadata: metadata?.[mimeType] as Record<string, unknown>,
            };
          }
        }

        this.store.commit(events.multimediaResultOutputAdded({
          id: crypto.randomUUID(),
          cellId: cell.id,
          position: outputPosition++,
          representations,
          executionCount: queueEntry.executionCount,
        }));
      },

      error: (ename: string, evalue: string, traceback: string[]) => {
        this.store.commit(events.errorOutputAdded({
          id: crypto.randomUUID(),
          cellId: cell.id,
          position: outputPosition++,
          content: {
            type: "inline",
            data: {
              ename,
              evalue,
              traceback,
            },
          },
        }));
      },

      // Markdown output methods for AI responses
      markdown: (content: string, metadata?: Record<string, unknown>) => {
        const outputId = crypto.randomUUID();
        this.store.commit(events.markdownOutputAdded({
          id: outputId,
          cellId: cell.id,
          position: outputPosition++,
          content: {
            type: "inline",
            data: content,
            metadata,
          },
        }));
        return outputId;
      },

      // Append to existing markdown output
      appendMarkdown: (
        outputId: string,
        delta: string,
        sequenceNumber: number,
      ) => {
        const id = crypto.randomUUID();
        this.store.commit(events.markdownOutputAppended2({
          id,
          outputId,
          delta,
          sequenceNumber,
        }));
        return id;
      },

      // Append to existing terminal output
      appendTerminal: (
        outputId: string,
        delta: string,
        sequenceNumber: number,
      ) => {
        const id = crypto.randomUUID();
        this.store.commit(events.terminalOutputAppended2({
          outputId,
          delta,
          id,
          sequenceNumber,
        }));
        return id;
      },

      clear: (wait: boolean = false) => {
        try {
          this.store.commit(events.cellOutputsCleared({
            cellId: cell.id,
            wait,
            clearedBy: `runtime-${this.options.runtimeId}`,
          }));
        } catch (error) {
          this.logger.debug("LiveStore commit failed for clear output", {
            error: error instanceof Error ? error.message : String(error),
            cellId: cell.id,
          });
        }

        if (!wait) {
          outputPosition = 0;
        }
      },
    };

    try {
      // Mark execution as started
      try {
        this.store.commit(events.executionStarted({
          queueId: queueEntry.id,
          cellId: queueEntry.cellId,
          runtimeSessionId: this.sessionId,
          startedAt: executionStartTime,
        }));
      } catch (error) {
        this.logger.debug("LiveStore commit failed for executionStarted", {
          error: error instanceof Error ? error.message : String(error),
          queueId: queueEntry.id,
          cellId: queueEntry.cellId,
        });
      }

      // Clear previous outputs (immediate clear)
      context.clear(false);

      const result: ExecutionResult = await this.executionHandler(context);

      // Add output if execution succeeded
      if (result.success && result.data) {
        context.result(result.data, result.metadata);
      }

      // Mark execution as completed
      const executionEndTime = new Date();
      const executionDurationMs = executionEndTime.getTime() -
        executionStartTime.getTime();

      try {
        this.store.commit(events.executionCompleted({
          queueId: queueEntry.id,
          cellId: queueEntry.cellId,
          status: result.success ? "success" : "error",
          error: result.error,
          completedAt: executionEndTime,
          executionDurationMs,
        }));
      } catch (error) {
        this.logger.debug("LiveStore commit failed for executionCompleted", {
          error: error instanceof Error ? error.message : String(error),
          queueId: queueEntry.id,
          cellId: queueEntry.cellId,
        });
      }

      this.logger.debug("Execution completed", {
        executionId: queueEntry.id,
        cellId: queueEntry.cellId,
        duration_ms: executionDurationMs,
        success: true,
      });
    } catch (error) {
      // Check if execution was cancelled
      if (controller.signal.aborted) {
        this.logger.debug("Execution was cancelled", {
          executionId: queueEntry.id,
          cellId: queueEntry.cellId,
        });
        return;
      }

      this.logger.error("Error in execution", error, {
        executionId: queueEntry.id,
        cellId: queueEntry.cellId,
      });

      // Call error handler with full context
      await this.handlers.onExecutionError?.(error as Error, context);

      try {
        const executionEndTime = new Date();
        const executionDurationMs = executionEndTime.getTime() -
          executionStartTime.getTime();

        this.store.commit(events.executionCompleted({
          queueId: queueEntry.id,
          cellId: queueEntry.cellId,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          completedAt: executionEndTime,
          executionDurationMs,
        }));
      } catch (commitError) {
        this.logger.error("Failed to mark execution as failed", commitError, {
          executionId: queueEntry.id,
          cellId: queueEntry.cellId,
        });
      }
    } finally {
      // Clean up active execution tracking
      this.activeExecutions.delete(queueEntry.id);
    }
  }

  /**
   * Process image content - simplified for core (no size-based artifacting)
   */
  private async processImageContent(
    mimeType: ImageMimeType,
    content: unknown,
    metadata?: Record<string, unknown>,
  ): Promise<MediaContainer> {
    // For core package, just return inline content
    // Platform-specific packages can override this with artifact upload logic
    return {
      type: "inline",
      data: content,
      metadata,
    };
  }

  /**
   * Keep the agent alive (for CLI usage)
   */
  async keepAlive(): Promise<void> {
    while (!this.isShuttingDown) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

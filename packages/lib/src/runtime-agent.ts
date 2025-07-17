// RuntimeAgent - Base class for building Anode runtime agents

import { makeAdapter } from "npm:@livestore/adapter-node";
import {
  createStorePromise,
  queryDb,
  type Store,
} from "npm:@livestore/livestore";
import { makeCfSync } from "npm:@livestore/sync-cf";
import {
  events,
  materializers,
  type MediaContainer,
  tables,
} from "@runt/schema";
import { createLogger } from "./logging.ts";
import { makeSchema, State } from "npm:@livestore/livestore";

// Create schema locally
const state = State.SQLite.makeState({ tables, materializers });
const schema = makeSchema({ events, state });
import type {
  CancellationHandler,
  CellData,
  ExecutionContext,
  ExecutionHandler,
  ExecutionQueueData,
  ExecutionResult,
  RawOutputData,
  RuntimeAgentEventHandlers,
  RuntimeCapabilities,
  RuntimeSessionData,
} from "./types.ts";
import type { RuntimeConfig } from "./config.ts";

/**
 * Base RuntimeAgent class providing LiveStore integration and execution management
 */
export class RuntimeAgent {
  #store!: Store<typeof schema>;
  private isShuttingDown = false;
  private processedExecutions = new Set<string>();

  private subscriptions: (() => void)[] = [];
  private activeExecutions = new Map<string, AbortController>();
  private cancellationHandlers: CancellationHandler[] = [];
  private signalHandlers = new Map<string, () => void>();

  constructor(
    public config: RuntimeConfig,
    private capabilities: RuntimeCapabilities,
    private handlers: RuntimeAgentEventHandlers = {},
  ) {}

  /**
   * Start the runtime agent - connects to LiveStore and begins processing
   */
  async start(): Promise<void> {
    try {
      await this.handlers.onStartup?.(this.config.environmentOptions);

      const logger = createLogger(`${this.config.runtimeType}-agent`, {
        context: {
          notebookId: this.config.notebookId,
          runtimeId: this.config.runtimeId,
          sessionId: this.config.sessionId,
        },
      });

      logger.info("Starting runtime agent", {
        runtimeType: this.config.runtimeType,
        notebookId: this.config.notebookId,
      });

      // Create LiveStore adapter for real-time collaboration
      const adapter = makeAdapter({
        storage: { type: "in-memory" },
        sync: {
          backend: makeCfSync({ url: this.config.syncUrl }),
          onSyncError: "ignore",
        },
      });

      this.#store = await createStorePromise({
        adapter,
        schema,
        storeId: this.config.notebookId,
        syncPayload: {
          authToken: this.config.authToken,
          runtime: true,
          runtimeId: this.config.runtimeId,
          sessionId: this.config.sessionId,
        },
      });

      // Register runtime session
      // Displace any existing active sessions for this notebook
      try {
        const existingSessions = this.store.query(
          tables.runtimeSessions.select().where({ isActive: true }),
        );

        for (const session of existingSessions) {
          try {
            this.store.commit(events.runtimeSessionTerminated({
              sessionId: session.sessionId,
              reason: "displaced",
            }));
          } catch (error) {
            // Mask LiveStore errors to prevent interference with runtime execution
            logger.debug("LiveStore commit failed for session termination", {
              error: error instanceof Error ? error.message : String(error),
              sessionId: session.sessionId,
            });
          }
        }
      } catch (error) {
        // Mask LiveStore errors to prevent interference with runtime execution
        logger.debug("LiveStore query failed for existing sessions", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Start session with "starting" status
      try {
        this.store.commit(events.runtimeSessionStarted({
          sessionId: this.config.sessionId,
          runtimeId: this.config.runtimeId,
          runtimeType: this.config.runtimeType,
          capabilities: this.capabilities,
        }));
      } catch (error) {
        // Mask LiveStore errors to prevent interference with runtime execution
        logger.debug("LiveStore commit failed for session start", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Set up reactive queries and subscriptions
      this.setupSubscriptions();

      // Mark session as ready
      try {
        this.store.commit(events.runtimeSessionStatusChanged({
          sessionId: this.config.sessionId,
          status: "ready",
        }));
      } catch (error) {
        // Mask LiveStore errors to prevent interference with runtime execution
        logger.debug("LiveStore commit failed for session ready", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await this.handlers.onConnected?.();
      logger.info("Runtime agent connected and ready");

      // Set up shutdown handlers
      this.setupShutdownHandlers();

      // No return value
    } catch (error) {
      const logger = createLogger(`${this.config.runtimeType}-agent`);
      logger.error("Failed to start runtime agent", error);
      await this.handlers.onDisconnected?.(error as Error);
      throw error;
    }
  }

  /**
   * Stop the runtime agent and clean up resources
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    const shutdownLogger = createLogger(`${this.config.runtimeType}-agent`);
    shutdownLogger.info("Runtime agent shutting down", {
      runtimeId: this.config.runtimeId,
      sessionId: this.config.sessionId,
    });

    try {
      await this.handlers.onShutdown?.();

      // Unsubscribe from all reactive queries
      this.subscriptions.forEach((unsubscribe) => unsubscribe());
      this.subscriptions = [];

      // Mark session as terminated
      try {
        if (this.#store) {
          // Terminate session on shutdown
          this.store.commit(events.runtimeSessionTerminated({
            sessionId: this.config.sessionId,
            reason: "shutdown",
          }));
        }
      } catch (error) {
        const termLogger = createLogger(`${this.config.runtimeType}-agent`);
        if (error instanceof Error) {
          termLogger.error("Failed to mark session as terminated", error);
        } else {
          termLogger.warn("Failed to mark session as terminated", {
            error: String(error),
          });
        }
      }

      // Clean up signal handlers
      this.cleanupSignalHandlers();

      // Close LiveStore connection
      if (this.#store) {
        await this.store.shutdown?.();
      }
    } catch (error) {
      const logger = createLogger(`${this.config.runtimeType}-agent`);
      logger.error("Error during shutdown", error, {
        runtimeId: this.config.runtimeId,
        sessionId: this.config.sessionId,
      });
    }

    shutdownLogger.info("Runtime agent shutdown complete", {
      runtimeId: this.config.runtimeId,
      sessionId: this.config.sessionId,
    });
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

  public get store(): Store<typeof schema> {
    return this.#store;
  }

  private executionHandler: ExecutionHandler = async (context) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Default handler - just echo the input
    return {
      success: true,
      data: {
        "text/plain": context.cell.source || "",
      },
      metadata: {},
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
          assignedRuntimeSession: this.config.sessionId,
        }),
      {
        label: "assignedWork",
        deps: [this.config.sessionId],
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

    // Watch for completed executions to clean up processedExecutions
    const completedExecutionsQuery$ = queryDb(
      tables.executionQueue.select()
        .where({ status: "completed" }),
      {
        label: "completedExecutions",
      },
    );

    // Watch for failed executions to clean up processedExecutions
    const failedExecutionsQuery$ = queryDb(
      tables.executionQueue.select()
        .where({ status: "failed" }),
      {
        label: "failedExecutions",
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

    // Subscribe to assigned work
    // NOTE: Using `as any` due to readonly vs mutable array type mismatch between
    // LiveStore query results and subscription system. This is a known limitation.
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
                const logger = createLogger(`${this.config.runtimeType}-agent`);
                logger.error("Error processing execution", error, {
                  executionId: queueEntry.id,
                  cellId: queueEntry.cellId,
                });
                // Error handling with full context happens within processExecution
              }
            }
          }, 0);
        },
      },
    );

    // Subscribe to pending work
    // NOTE: Using `as any` due to readonly vs mutable array type mismatch between
    // LiveStore query results and subscription system. This is a known limitation.
    const pendingWorkSub = this.store.subscribe(
      pendingWorkQuery$,
      {
        onUpdate: (entries: readonly ExecutionQueueData[]) => {
          if (this.isShuttingDown) return;

          if (entries.length > 0) {
            const logger = createLogger(`${this.config.runtimeType}-agent`);

            // Log cell count for sync debugging
            try {
              const allCells = this.store.query(tables.cells.select());
              logger.info("Runtime sync status", {
                pendingExecutions: entries.length,
                totalCells: allCells.length,
                cellIds: allCells.map((c) => c.id),
              });
            } catch (error) {
              // Mask LiveStore errors to prevent interference with runtime execution
              logger.debug("LiveStore query failed for sync status", {
                error: error instanceof Error ? error.message : String(error),
                pendingExecutions: entries.length,
              });
            }

            logger.debug("Pending executions", {
              count: entries.length,
              executions: entries.map((e) => ({ id: e.id, cellId: e.cellId })),
            });
          }

          setTimeout(() => {
            let activeRuntimes: readonly RuntimeSessionData[] = [];
            let ourRuntime: RuntimeSessionData | undefined;

            try {
              activeRuntimes = this.store.query(activeRuntimesQuery$);
              ourRuntime = activeRuntimes.find((r: RuntimeSessionData) =>
                r.sessionId === this.config.sessionId
              );
            } catch (error) {
              // Mask LiveStore errors to prevent interference with runtime execution
              const logger = createLogger(`${this.config.runtimeType}-agent`);
              logger.debug("LiveStore query failed for active runtimes", {
                error: error instanceof Error ? error.message : String(error),
                sessionId: this.config.sessionId,
              });
              return;
            }

            if (!ourRuntime) return;

            // Try to claim first pending execution
            const firstPending = entries[0];
            if (firstPending && firstPending.status === "pending") {
              try {
                this.store.commit(events.executionAssigned({
                  queueId: firstPending.id,
                  runtimeSessionId: this.config.sessionId,
                }));
              } catch (_error) {
                // Silently fail - another runtime may have claimed it
              }
            }
          }, 0);
        },
      },
    );

    // Subscribe to cancelled work
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

    // Subscribe to completed executions for cleanup
    const completedExecutionsSub = this.store.subscribe(
      completedExecutionsQuery$,
      {
        onUpdate: (entries: readonly ExecutionQueueData[]) => {
          if (this.isShuttingDown) return;

          // Clean up processedExecutions Set for completed work
          for (const entry of entries) {
            this.processedExecutions.delete(entry.id);
          }
        },
      },
    );

    // Subscribe to failed executions for cleanup
    const failedExecutionsSub = this.store.subscribe(
      failedExecutionsQuery$,
      {
        onUpdate: (entries: readonly ExecutionQueueData[]) => {
          if (this.isShuttingDown) return;

          // Clean up processedExecutions Set for failed work
          for (const entry of entries) {
            this.processedExecutions.delete(entry.id);
          }
        },
      },
    );

    // Store subscriptions for cleanup
    this.subscriptions.push(
      assignedWorkSub,
      pendingWorkSub,
      cancelledWorkSub,
      completedExecutionsSub,
      failedExecutionsSub,
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
      const logger = createLogger(`${this.config.runtimeType}-agent`);
      logger.debug("Cancelling execution", {
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
          const cancelLogger = createLogger(`${this.config.runtimeType}-agent`);
          if (error instanceof Error) {
            cancelLogger.error("Cancellation handler error", error);
          } else {
            cancelLogger.warn("Cancellation handler error", {
              error: String(error),
            });
          }
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
    const logger = createLogger(`${this.config.runtimeType}-agent`);
    logger.debug("Processing execution", {
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
      // Mask LiveStore errors but still need to handle missing cell
      const logger = createLogger(`${this.config.runtimeType}-agent`);
      logger.debug("LiveStore query failed for cell data", {
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
    // State tracking for unified output system
    let outputPosition = 0;

    // Create execution context (available in catch block for error handler)
    const context: ExecutionContext = {
      cell,
      queueEntry,
      store: this.store,
      sessionId: this.config.sessionId,
      runtimeId: this.config.runtimeId,
      abortSignal: controller.signal,
      checkCancellation: () => {
        if (controller.signal.aborted) {
          throw new Error("Execution cancelled");
        }
      },

      // Output emission methods for real-time streaming
      stdout: (text: string) => {
        if (text) {
          try {
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
          } catch (error) {
            // Mask LiveStore errors to prevent interference with runtime execution
            const logger = createLogger(`${this.config.runtimeType}-agent`);
            logger.debug("LiveStore commit failed for stdout output", {
              error: error instanceof Error ? error.message : String(error),
              cellId: cell.id,
            });
          }
        }
      },

      // Append to existing terminal output (for streaming)
      appendTerminal: (outputId: string, text: string) => {
        if (text) {
          try {
            this.store.commit(events.terminalOutputAppended({
              outputId,
              content: {
                type: "inline",
                data: text,
              },
            }));
          } catch (error) {
            // Mask LiveStore errors to prevent interference with runtime execution
            const logger = createLogger(`${this.config.runtimeType}-agent`);
            logger.debug("LiveStore commit failed for appendTerminal output", {
              error: error instanceof Error ? error.message : String(error),
              outputId,
            });
          }
        }
      },

      stderr: (text: string) => {
        if (text) {
          try {
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
          } catch (error) {
            // Mask LiveStore errors to prevent interference with runtime execution
            const logger = createLogger(`${this.config.runtimeType}-agent`);
            logger.debug("LiveStore commit failed for stderr output", {
              error: error instanceof Error ? error.message : String(error),
              cellId: cell.id,
            });
          }
        }
      },

      display: (
        data: RawOutputData,
        metadata?: Record<string, unknown>,
        displayId?: string,
      ) => {
        // Convert raw data to MediaContainer representations
        const representations: Record<
          string,
          MediaContainer
        > = {};

        for (const [mimeType, content] of Object.entries(data)) {
          representations[mimeType] = {
            type: "inline",
            data: content, // Keep JSON objects as-is, don't stringify
            metadata: metadata?.[mimeType] as Record<string, unknown>,
          };
        }

        try {
          this.store.commit(events.multimediaDisplayOutputAdded({
            id: crypto.randomUUID(),
            cellId: cell.id,
            position: outputPosition++,
            representations,
            displayId,
          }));
        } catch (error) {
          // Mask LiveStore errors to prevent interference with runtime execution
          const logger = createLogger(`${this.config.runtimeType}-agent`);
          logger.debug("LiveStore commit failed for display output", {
            error: error instanceof Error ? error.message : String(error),
            cellId: cell.id,
            displayId,
          });
        }
      },

      updateDisplay: (
        displayId: string,
        data: RawOutputData,
        metadata?: Record<string, unknown>,
      ) => {
        // For updated displays, use the dedicated update event (no new output created)
        const representations: Record<
          string,
          MediaContainer
        > = {};

        for (const [mimeType, content] of Object.entries(data)) {
          representations[mimeType] = {
            type: "inline",
            data: content, // Keep JSON objects as-is, don't stringify
            metadata: metadata?.[mimeType] as Record<string, unknown>,
          };
        }

        try {
          this.store.commit(events.multimediaDisplayOutputUpdated({
            displayId,
            representations,
          }));
        } catch (error) {
          // Mask LiveStore errors to prevent interference with runtime execution
          const logger = createLogger(`${this.config.runtimeType}-agent`);
          logger.debug("LiveStore commit failed for updateDisplay output", {
            error: error instanceof Error ? error.message : String(error),
            displayId,
          });
        }
      },

      result: (
        data: RawOutputData,
        metadata?: Record<string, unknown>,
      ) => {
        // Convert raw data to MediaContainer representations
        const representations: Record<
          string,
          MediaContainer
        > = {};

        for (const [mimeType, content] of Object.entries(data)) {
          representations[mimeType] = {
            type: "inline",
            data: content, // Keep JSON objects as-is for Altair plots, etc.
            metadata: metadata?.[mimeType] as Record<string, unknown>,
          };
        }

        try {
          this.store.commit(events.multimediaResultOutputAdded({
            id: crypto.randomUUID(),
            cellId: cell.id,
            position: outputPosition++,
            representations,
            executionCount: queueEntry.executionCount,
          }));
        } catch (error) {
          // Mask LiveStore errors to prevent interference with runtime execution
          const logger = createLogger(`${this.config.runtimeType}-agent`);
          logger.debug("LiveStore commit failed for result output", {
            error: error instanceof Error ? error.message : String(error),
            cellId: cell.id,
          });
        }
      },

      error: (ename: string, evalue: string, traceback: string[]) => {
        try {
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
        } catch (error) {
          // Mask LiveStore errors to prevent interference with runtime execution
          const logger = createLogger(`${this.config.runtimeType}-agent`);
          logger.debug("LiveStore commit failed for error output", {
            error: error instanceof Error ? error.message : String(error),
            cellId: cell.id,
            ename,
          });
        }
      },

      // Markdown output methods for AI responses
      markdown: (content: string, metadata?: Record<string, unknown>) => {
        const outputId = crypto.randomUUID();
        try {
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
        } catch (error) {
          // Mask LiveStore errors to prevent interference with runtime execution
          const logger = createLogger(`${this.config.runtimeType}-agent`);
          logger.debug("LiveStore commit failed for markdown output", {
            error: error instanceof Error ? error.message : String(error),
            cellId: cell.id,
            outputId,
          });
        }
        return outputId;
      },

      // Append to existing markdown output (for streaming AI responses)
      appendMarkdown: (outputId: string, content: string) => {
        try {
          this.store.commit(events.markdownOutputAppended({
            outputId,
            content: {
              type: "inline",
              data: content,
            },
          }));
        } catch (error) {
          // Mask LiveStore errors to prevent interference with runtime execution
          const logger = createLogger(`${this.config.runtimeType}-agent`);
          logger.debug("LiveStore commit failed for appendMarkdown output", {
            error: error instanceof Error ? error.message : String(error),
            outputId,
          });
        }
      },

      clear: (wait: boolean = false) => {
        try {
          this.store.commit(events.cellOutputsCleared({
            cellId: cell.id,
            wait,
            clearedBy: `runtime-${this.config.runtimeId}`,
          }));
        } catch (error) {
          // Mask LiveStore errors to prevent interference with runtime execution
          const logger = createLogger(`${this.config.runtimeType}-agent`);
          logger.debug("LiveStore commit failed for clear output", {
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
          runtimeSessionId: this.config.sessionId,
          startedAt: executionStartTime,
        }));
      } catch (error) {
        // Mask LiveStore errors to prevent interference with runtime execution
        const logger = createLogger(`${this.config.runtimeType}-agent`);
        logger.debug("LiveStore commit failed for executionStarted", {
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
        // Mask LiveStore errors to prevent interference with runtime execution
        const logger = createLogger(`${this.config.runtimeType}-agent`);
        logger.debug("LiveStore commit failed for executionCompleted", {
          error: error instanceof Error ? error.message : String(error),
          queueId: queueEntry.id,
          cellId: queueEntry.cellId,
        });
      }

      logger.debug("Execution completed", {
        executionId: queueEntry.id,
        cellId: queueEntry.cellId,
        duration_ms: executionDurationMs,
        success: true,
      });
    } catch (error) {
      // Check if execution was cancelled
      if (controller.signal.aborted) {
        logger.debug("Execution was cancelled", {
          executionId: queueEntry.id,
          cellId: queueEntry.cellId,
        });
        // Don't commit error for cancelled executions - schema handles this
        return;
      }

      logger.error("Error in execution", error, {
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
        logger.error("Failed to mark execution as failed", commitError, {
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
   * Set up shutdown signal handlers
   */
  private setupShutdownHandlers(): void {
    const shutdown = () => this.shutdown();

    // Store signal handlers for cleanup
    this.signalHandlers.set("SIGINT", shutdown);
    this.signalHandlers.set("SIGTERM", shutdown);

    Deno.addSignalListener("SIGINT" as Deno.Signal, shutdown);
    Deno.addSignalListener("SIGTERM" as Deno.Signal, shutdown);

    globalThis.addEventListener("unhandledrejection", (event) => {
      const errorLogger = createLogger(`${this.config.runtimeType}-agent`);
      errorLogger.error(
        "Unhandled rejection",
        event.reason instanceof Error ? event.reason : undefined,
        {
          reason: event.reason instanceof Error
            ? undefined
            : String(event.reason),
        },
      );
      shutdown();
    });

    globalThis.addEventListener("error", (event) => {
      const errorLogger = createLogger(`${this.config.runtimeType}-agent`);
      errorLogger.error(
        "Uncaught error",
        event.error instanceof Error ? event.error : undefined,
        {
          error: event.error instanceof Error ? undefined : String(event.error),
        },
      );
      shutdown();
    });
  }

  /**
   * Clean up signal handlers
   */
  private cleanupSignalHandlers(): void {
    for (const [signal, handler] of this.signalHandlers) {
      try {
        Deno.removeSignalListener(signal as Deno.Signal, handler);
      } catch (error) {
        // Ignore errors during cleanup
        const cleanupLogger = createLogger(`${this.config.runtimeType}-agent`);
        cleanupLogger.debug("Error removing signal listener", {
          signal,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.signalHandlers.clear();
  }

  /**
   * Keep the agent alive until shutdown
   */
  async keepAlive(): Promise<void> {
    while (!this.isShuttingDown) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

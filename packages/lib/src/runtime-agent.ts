// RuntimeAgent - Base class for building Anode runtime agents

import { makeAdapter } from "npm:@livestore/adapter-node";
import {
  createStorePromise,
  queryDb,
  type Store,
} from "npm:@livestore/livestore";
import { makeCfSync } from "npm:@livestore/sync-cf";
import { events, schema, tables } from "@runt/schema";
import { createLogger } from "./logging.ts";
import type {
  CancellationHandler,
  CellData,
  ErrorOutputData,
  ExecutionContext,
  ExecutionHandler,
  ExecutionQueueData,
  ExecutionResult,
  KernelCapabilities,
  RichOutputData,
  RuntimeAgentEventHandlers,
  StreamOutputData,
} from "./types.ts";
import type { RuntimeConfig } from "./config.ts";

/**
 * Base RuntimeAgent class providing LiveStore integration and execution management
 */
export class RuntimeAgent {
  private store!: Store<typeof schema>;
  private isShuttingDown = false;
  private processedExecutions = new Set<string>();
  private heartbeatInterval: number | null = null;
  private subscriptions: (() => void)[] = [];
  private activeExecutions = new Map<string, AbortController>();
  private cancellationHandlers: CancellationHandler[] = [];
  private signalHandlers = new Map<string, () => void>();

  constructor(
    private config: RuntimeConfig,
    private capabilities: KernelCapabilities,
    private handlers: RuntimeAgentEventHandlers = {},
  ) {}

  /**
   * Start the runtime agent - connects to LiveStore and begins processing
   */
  async start(): Promise<void> {
    try {
      await this.handlers.onStartup?.();

      const logger = createLogger(`${this.config.kernelType}-agent`, {
        context: {
          notebookId: this.config.notebookId,
          kernelId: this.config.kernelId,
          sessionId: this.config.sessionId,
        },
      });

      logger.info("Starting runtime agent", {
        kernelType: this.config.kernelType,
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

      this.store = await createStorePromise({
        adapter,
        schema,
        storeId: this.config.notebookId,
        syncPayload: {
          authToken: this.config.authToken,
          kernel: true,
          kernelId: this.config.kernelId,
          sessionId: this.config.sessionId,
        },
      });

      // Register kernel session
      this.store.commit(events.kernelSessionStarted({
        sessionId: this.config.sessionId,
        kernelId: this.config.kernelId,
        kernelType: this.config.kernelType,
        capabilities: this.capabilities,
      }));

      // Send initial heartbeat
      this.store.commit(events.kernelSessionHeartbeat({
        sessionId: this.config.sessionId,
        status: "ready",
        timestamp: new Date(),
      }));

      // Set up reactive queries and subscriptions
      this.setupSubscriptions();

      // Start heartbeat timer
      this.startHeartbeat();

      await this.handlers.onConnected?.();
      logger.info("Runtime agent connected and ready");

      // Set up shutdown handlers
      this.setupShutdownHandlers();
    } catch (error) {
      const logger = createLogger(`${this.config.kernelType}-agent`);
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

    const shutdownLogger = createLogger(`${this.config.kernelType}-agent`);
    shutdownLogger.info("Runtime agent shutting down", {
      kernelId: this.config.kernelId,
      sessionId: this.config.sessionId,
    });

    try {
      await this.handlers.onShutdown?.();

      // Stop heartbeat
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      // Unsubscribe from all reactive queries
      this.subscriptions.forEach((unsubscribe) => unsubscribe());
      this.subscriptions = [];

      // Mark session as terminated
      try {
        if (this.store) {
          this.store.commit(events.kernelSessionTerminated({
            sessionId: this.config.sessionId,
            reason: "shutdown",
          }));
        }
      } catch (error) {
        const termLogger = createLogger(`${this.config.kernelType}-agent`);
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
      if (this.store) {
        await this.store.shutdown?.();
      }
    } catch (error) {
      const logger = createLogger(`${this.config.kernelType}-agent`);
      logger.error("Error during shutdown", error, {
        kernelId: this.config.kernelId,
        sessionId: this.config.sessionId,
      });
    }

    shutdownLogger.info("Runtime agent shutdown complete", {
      kernelId: this.config.kernelId,
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

  /**
   * Get the LiveStore instance (for testing)
   */
  get liveStore(): Store<typeof schema> {
    return this.store;
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
    // Watch for work assigned to this specific kernel
    const assignedWorkQuery$ = queryDb(
      tables.executionQueue.select()
        .where({
          status: "assigned",
          assignedKernelSession: this.config.sessionId,
        })
        .orderBy("priority", "desc"),
      {
        label: "assignedWork",
        deps: [this.config.sessionId],
      },
    );

    // Watch for pending work to claim
    const pendingWorkQuery$ = queryDb(
      tables.executionQueue.select()
        .where({ status: "pending" })
        .orderBy("priority", "desc"),
      {
        label: "pendingWork",
      },
    );

    // Watch for active kernels
    const activeKernelsQuery$ = queryDb(
      tables.kernelSessions.select()
        .where({ isActive: true })
        .orderBy("lastHeartbeat", "desc"),
      {
        label: "activeKernels",
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
                const logger = createLogger(`${this.config.kernelType}-agent`);
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
            const logger = createLogger(`${this.config.kernelType}-agent`);

            // Log cell count for sync debugging
            const allCells = this.store.query(tables.cells.select());
            logger.info("Runtime sync status", {
              pendingExecutions: entries.length,
              totalCells: allCells.length,
              cellIds: allCells.map((c) => c.id),
            });

            logger.debug("Pending executions", {
              count: entries.length,
              executions: entries.map((e) => ({ id: e.id, cellId: e.cellId })),
            });
          }

          setTimeout(() => {
            const activeKernels = this.store.query(activeKernelsQuery$);
            const ourKernel = activeKernels.find((k) =>
              k.sessionId === this.config.sessionId
            );

            if (!ourKernel) return;

            // Try to claim first pending execution
            const firstPending = entries[0];
            if (firstPending && firstPending.status === "pending") {
              try {
                this.store.commit(events.executionAssigned({
                  queueId: firstPending.id,
                  kernelSessionId: this.config.sessionId,
                }));
              } catch (_error) {
                // Silently fail - another kernel may have claimed it
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
      const logger = createLogger(`${this.config.kernelType}-agent`);
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
          const cancelLogger = createLogger(`${this.config.kernelType}-agent`);
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
    const logger = createLogger(`${this.config.kernelType}-agent`);
    logger.debug("Processing execution", {
      executionId: queueEntry.id,
      cellId: queueEntry.cellId,
    });

    // Create AbortController for this execution
    const controller = new AbortController();
    this.activeExecutions.set(queueEntry.id, controller);

    const executionStartTime = new Date();

    // Get cell data
    const cells = this.store.query(
      tables.cells.select().where({ id: queueEntry.cellId }),
    );
    const cell = cells[0] as CellData;

    if (!cell) {
      this.activeExecutions.delete(queueEntry.id);
      throw new Error(`Cell ${queueEntry.cellId} not found`);
    }

    // Track output position for proper ordering
    let outputPosition = 0;

    // Create execution context (available in catch block for error handler)
    const context: ExecutionContext = {
      cell,
      queueEntry,
      store: this.store,
      sessionId: this.config.sessionId,
      kernelId: this.config.kernelId,
      abortSignal: controller.signal,
      checkCancellation: () => {
        if (controller.signal.aborted) {
          throw new Error("Execution cancelled");
        }
      },

      // Output emission methods for real-time streaming
      stdout: (text: string) => {
        if (text) {
          this.store.commit(events.cellOutputAdded({
            id: crypto.randomUUID(),
            cellId: cell.id,
            outputType: "stream",
            data: {
              name: "stdout",
              text,
            } as StreamOutputData,
            metadata: {},
            position: outputPosition++,
          }));
        }
      },

      stderr: (text: string) => {
        if (text) {
          this.store.commit(events.cellOutputAdded({
            id: crypto.randomUUID(),
            cellId: cell.id,
            outputType: "stream",
            data: {
              name: "stderr",
              text,
            } as StreamOutputData,
            metadata: {},
            position: outputPosition++,
          }));
        }
      },

      display: (
        data: RichOutputData,
        metadata?: Record<string, unknown>,
        displayId?: string,
      ) => {
        this.store.commit(events.cellOutputAdded({
          id: crypto.randomUUID(),
          cellId: cell.id,
          outputType: "display_data",
          data,
          metadata: metadata || {},
          position: outputPosition++,
          displayId,
        }));
      },

      updateDisplay: (
        displayId: string,
        data: RichOutputData,
        metadata?: Record<string, unknown>,
      ) => {
        this.store.commit(events.cellOutputUpdated({
          id: displayId,
          data,
          metadata: metadata || {},
        }));
      },

      result: (
        data: RichOutputData,
        metadata?: Record<string, unknown>,
      ) => {
        this.store.commit(events.cellOutputAdded({
          id: crypto.randomUUID(),
          cellId: cell.id,
          outputType: "execute_result",
          data,
          metadata: metadata || {},
          position: outputPosition++,
        }));
      },

      error: (ename: string, evalue: string, traceback: string[]) => {
        this.store.commit(events.cellOutputAdded({
          id: crypto.randomUUID(),
          cellId: cell.id,
          outputType: "error",
          data: {
            ename,
            evalue,
            traceback,
          } as ErrorOutputData,
          metadata: {},
          position: outputPosition++,
        }));
      },

      clear: () => {
        this.store.commit(events.cellOutputsCleared({
          cellId: cell.id,
          clearedBy: `kernel-${this.config.kernelId}`,
        }));
        outputPosition = 0;
      },
    };

    try {
      // Mark execution as started
      this.store.commit(events.executionStarted({
        queueId: queueEntry.id,
        cellId: queueEntry.cellId,
        kernelSessionId: this.config.sessionId,
        startedAt: executionStartTime,
      }));

      // Clear previous outputs
      this.store.commit(events.cellOutputsCleared({
        cellId: cell.id,
        clearedBy: `kernel-${this.config.kernelId}`,
      }));

      const result: ExecutionResult = await this.executionHandler(context);

      // Add output if execution succeeded
      if (result.success && result.data) {
        this.store.commit(events.cellOutputAdded({
          id: crypto.randomUUID(),
          cellId: cell.id,
          outputType: result.outputType || "execute_result",
          data: result.data,
          metadata: result.metadata || {},
          position: outputPosition++,
        }));
      }

      // Mark execution as completed
      const executionEndTime = new Date();
      const executionDurationMs = executionEndTime.getTime() -
        executionStartTime.getTime();

      this.store.commit(events.executionCompleted({
        queueId: queueEntry.id,
        cellId: queueEntry.cellId,
        status: result.success ? "success" : "error",
        error: result.error,
        completedAt: executionEndTime,
        executionDurationMs,
      }));

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
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.isShuttingDown) return;

      try {
        this.store.commit(events.kernelSessionHeartbeat({
          sessionId: this.config.sessionId,
          status: "ready",
          timestamp: new Date(),
        }));
      } catch (error) {
        const heartbeatLogger = createLogger(`${this.config.kernelType}-agent`);
        if (error instanceof Error) {
          heartbeatLogger.error("Heartbeat failed", error);
        } else {
          heartbeatLogger.warn("Heartbeat failed", {
            error: String(error),
          });
        }
      }
    }, this.config.heartbeatInterval);
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
      const errorLogger = createLogger(`${this.config.kernelType}-agent`);
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
      const errorLogger = createLogger(`${this.config.kernelType}-agent`);
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
        const cleanupLogger = createLogger(`${this.config.kernelType}-agent`);
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

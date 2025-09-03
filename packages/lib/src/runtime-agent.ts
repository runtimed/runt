// RuntimeAgent - Base class for building Anode runtime agents

import {
  createStorePromise,
  queryDb,
  type Store,
} from "npm:@livestore/livestore";

import {
  events,
  type ImageMimeType,
  isImageMimeType,
  materializers,
  type MediaContainer,
  tables,
} from "@runt/schema";
import { logger } from "./logging.ts";
import { makeSchema, State } from "npm:@livestore/livestore";

// Create schema locally
const state = State.SQLite.makeState({ tables, materializers });
const schema = makeSchema({ events, state });
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
  RuntimeCapabilities,
  RuntimeSessionData,
} from "./types.ts";
import type { RuntimeConfig } from "./config.ts";

import { decodeBase64 } from "@std/encoding/base64";

/**
 * Base RuntimeAgent class providing LiveStore integration and execution management
 */
export class RuntimeAgent {
  #store!: Store<typeof schema>;
  // Use global logger instance from logging module
  private isShuttingDown = false;
  private processedExecutions = new Set<string>();

  private subscriptions: (() => void)[] = [];
  private activeExecutions = new Map<string, AbortController>();
  private cancellationHandlers: CancellationHandler[] = [];

  private artifactClient: IArtifactClient;

  constructor(
    public config: RuntimeConfig,
    private capabilities: RuntimeCapabilities,
    private handlers: RuntimeAgentEventHandlers = {},
  ) {
    this.artifactClient = config.artifactClient;
  }

  /**
   * Start the runtime agent - connects to LiveStore and begins processing
   */
  async start(): Promise<void> {
    try {
      await this.handlers.onStartup?.();

      // Global logger is configured at application startup

      logger.info("Starting runtime agent", {
        runtimeId: this.config.runtimeId,
        runtimeType: this.config.runtimeType,
        notebookId: this.config.notebookId,
      });

      // Use provided clientId (now required)
      const clientId = this.config.clientId;
      logger.info("Using clientId", { clientId });

      // Create store with required adapter
      const adapter = this.config.adapter;
      if (!adapter) {
        throw new Error(
          "RuntimeAgent requires an adapter to be provided via config.adapter",
        );
      }

      this.#store = await createStorePromise({
        adapter,
        schema,
        storeId: this.config.notebookId,
        syncPayload: {
          authToken: this.config.authToken,
          runtime: true,
          runtimeId: this.config.runtimeId,
          sessionId: this.config.sessionId,
          clientId,
          userId: this.config.userId,
        },
      });

      // Register global debug access
      // @ts-expect-error: Global debug access
      globalThis.__debugLiveStore = globalThis.__debugLiveStore || {};
      // @ts-expect-error: Global debug access
      globalThis.__debugLiveStore[this.config.notebookId] = this.#store;

      logger.info("LiveStore initialized", {
        storeId: this.config.notebookId,
        hasCustomAdapter: !!this.config.adapter,
      });

      // Register runtime session
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

      // Start session with "starting" status
      this.store.commit(events.runtimeSessionStarted({
        sessionId: this.config.sessionId,
        runtimeId: this.config.runtimeId,
        runtimeType: this.config.runtimeType,
        capabilities: this.capabilities,
      }));

      // Set up reactive queries and subscriptions
      this.setupSubscriptions();

      // Mark session as ready
      this.store.commit(events.runtimeSessionStatusChanged({
        sessionId: this.config.sessionId,
        status: "ready",
      }));

      await this.handlers.onConnected?.();
      logger.info("Runtime agent connected and ready");

      // Pretty console output for successful connection
      const connectionUrl = new URL(this.config.syncUrl);
      const hostname = connectionUrl.hostname;

      console.log(`\n🚀 \x1b[32m✅ Runtime agent connected and ready!\x1b[0m`);
      console.log(`   \x1b[36mNotebook ID:\x1b[0m ${this.config.notebookId}`);
      console.log(`   \x1b[36mConnected to:\x1b[0m ${hostname}`);
      console.log(`   \x1b[36mRuntime Type:\x1b[0m ${this.config.runtimeType}`);
      console.log(`   \x1b[36mSession ID:\x1b[0m  ${this.config.sessionId}`);
      console.log(
        `\n\x1b[33m💡 Runtime is now listening for notebook events...\x1b[0m\n`,
      );

      // Set up shutdown handlers
      this.setupShutdownHandlers();

      // No return value
    } catch (error) {
      logger.error("Failed to start runtime agent", error);
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

    logger.info("Runtime agent shutting down", {
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
        if (error instanceof Error) {
          logger.error("Failed to mark session as terminated", error);
        } else {
          logger.warn("Failed to mark session as terminated", {
            error: String(error),
          });
        }
      }

      // Clean up shutdown handlers
      this.cleanupShutdownHandlers();

      // Close LiveStore connection
      if (this.#store) {
        await this.store.shutdown?.();
      }
    } catch (error) {
      logger.error("Error during shutdown", error, {
        runtimeId: this.config.runtimeId,
        sessionId: this.config.sessionId,
      });
    }

    logger.info("Runtime agent shutdown complete", {
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
              this.store.commit(events.executionAssigned({
                queueId: firstPending.id,
                runtimeSessionId: this.config.sessionId,
              }));
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
          if (error instanceof Error) {
            logger.error("Cancellation handler error", error);
          } else {
            logger.warn("Cancellation handler error", {
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

      // Append to existing terminal output (for streaming)
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
        const representations: Record<
          string,
          MediaContainer
        > = {};

        for (const [mimeType, content] of Object.entries(data)) {
          // Process images with size-based artifact upload
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

        // Add text representations for image artifacts
        this.generateTextRepresentationsForArtifacts(representations);

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
        // For updated displays, use the dedicated update event (no new output created)
        const representations: Record<
          string,
          MediaContainer
        > = {};

        for (const [mimeType, content] of Object.entries(data)) {
          // Process images with size-based artifact upload
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

        // Add text representations for image artifacts
        this.generateTextRepresentationsForArtifacts(representations);

        this.store.commit(events.multimediaDisplayOutputUpdated({
          displayId,
          representations,
        }));
      },

      result: async (
        data: RawOutputData,
        metadata?: Record<string, unknown>,
      ) => {
        // Convert raw data to MediaContainer representations
        const representations: Record<
          string,
          MediaContainer
        > = {};

        for (const [mimeType, content] of Object.entries(data)) {
          // Process images with size-based artifact upload
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

        // Add text representations for image artifacts
        this.generateTextRepresentationsForArtifacts(representations);

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

      // Append to existing markdown output (for streaming AI responses)
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

      clear: (wait: boolean = false) => {
        try {
          this.store.commit(events.cellOutputsCleared({
            cellId: cell.id,
            wait,
            clearedBy: `runtime-${this.config.runtimeId}`,
          }));
        } catch (error) {
          // Mask LiveStore errors to prevent interference with runtime execution
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
   * Set up shutdown handlers
   * Override this method in subclasses to add platform-specific signal handling
   */
  protected setupShutdownHandlers(): void {
    const shutdown = () => this.shutdown();

    // Set up global error handlers (platform-agnostic)
    globalThis.addEventListener("unhandledrejection", (event) => {
      logger.error(
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
      logger.error(
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
   * Clean up shutdown handlers
   * Override this method in subclasses to clean up platform-specific handlers
   */
  protected cleanupShutdownHandlers(): void {
    // Base implementation does nothing
    // Subclasses can override to clean up their specific handlers
  }

  /**
   * Process image content and upload to artifact service if above size threshold
   */
  protected async processImageContent(
    mimeType: ImageMimeType,
    content: unknown,
    metadata?: Record<string, unknown>,
  ): Promise<MediaContainer> {
    // Only process PNG images for now
    if (mimeType !== "image/png" || typeof content !== "string") {
      return {
        type: "inline",
        data: content,
        metadata,
      };
    }

    try {
      // Decode base64 to check size
      const imageData = decodeBase64(content);
      const imageSizeBytes = imageData.length;

      logger.debug("Processing image content for artifact upload", {
        mimeType,
        imageSizeBytes,
        thresholdBytes: this.config.imageArtifactThresholdBytes,
        willUploadAsArtifact:
          imageSizeBytes > this.config.imageArtifactThresholdBytes,
      });

      // If image is below threshold, keep inline
      if (imageSizeBytes <= this.config.imageArtifactThresholdBytes) {
        logger.debug("Image below threshold, keeping inline", {
          mimeType,
          imageSizeBytes,
          thresholdBytes: this.config.imageArtifactThresholdBytes,
        });
        return {
          type: "inline",
          data: content,
          metadata,
        };
      }

      logger.debug("Image above threshold, uploading as artifact", {
        mimeType,
        imageSizeBytes,
        thresholdBytes: this.config.imageArtifactThresholdBytes,
      });

      // Upload large image as artifact
      const submissionOptions: ArtifactSubmissionOptions = {
        notebookId: this.config.notebookId,
        authToken: this.config.authToken,
        mimeType,
        filename: `image_${Date.now()}.png`,
      };

      // TODO: Support multipart uploads for large images in the future
      const result = await this.artifactClient.submitContent(
        imageData,
        submissionOptions,
      );

      logger.debug("Image successfully uploaded as artifact", {
        mimeType,
        artifactId: result.artifactId,
        imageSizeBytes,
      });

      return {
        type: "artifact",
        artifactId: result.artifactId,
        metadata: {
          ...metadata,
          originalSizeBytes: imageSizeBytes,
          uploadedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      // If artifact upload fails, fall back to inline

      logger.warn(
        "Failed to upload image as artifact, falling back to inline",
        {
          error: error instanceof Error ? error.message : String(error),
          mimeType,
          imageSize: typeof content === "string" ? content.length : "unknown",
        },
      );

      return {
        type: "inline",
        data: content,
        metadata,
      };
    }
  }

  /**
   * Generate appropriate text representations for image artifacts
   */
  protected generateTextRepresentationsForArtifacts(
    representations: Record<string, MediaContainer>,
  ): void {
    for (const [mimeType, container] of Object.entries(representations)) {
      if (isImageMimeType(mimeType) && container.type === "artifact") {
        // NOTE: This will use the "last" artifact to set in the text/plain representation
        //       without regard for the display order of the receiving client(s).
        //
        //       However, this is mainly a fallback for clients that do not support images/html.
        if (!representations["text/plain"]) {
          const artifactUrl = this.artifactClient.getArtifactUrl(
            container.artifactId,
          );
          representations["text/plain"] = {
            type: "inline",
            data: `${mimeType} artifact: ${artifactUrl}`,
            metadata: { generatedFor: mimeType },
          };
        }

        if (!representations["text/markdown"]) {
          const artifactUrl = this.artifactClient.getArtifactUrl(
            container.artifactId,
          );

          // Convert name shown to something displayable in markdown (escapsing as necessary) relying on
          // the mimetype and or artifact ID
          const name = "Artifact_" +
            container.artifactId.replace(/[^a-zA-Z0-9]/g, "_") +
            mimeType.replace(/[^a-zA-Z0-9]/g, "_");

          representations["text/markdown"] = {
            type: "inline",
            data: `![${name}](${artifactUrl})`,
            metadata: { generatedFor: mimeType },
          };
        }
      }
    }
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

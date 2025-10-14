// Pyodide Runtime Agent
//
// This module provides a Pyodide-based Python runtime agent with advanced
// IPython integration, rich display support, and true interruption support
// via Pyodide's built-in interrupt system.

import { RuntimeAgent } from "@runtimed/agent-core";
import {
  createPyodideRuntimeConfig,
  type PyodideRuntimeConfig,
} from "./pyodide-config.ts";
import type { Adapter, Store } from "jsr:@runtimed/schema";
import type {
  ExecutionContext,
  RuntimeCapabilities,
} from "@runtimed/agent-core";

import { logger, LogLevel } from "@runtimed/agent-core";
import {
  cellReferences$,
  isJsonMimeType,
  isTextBasedMimeType,
  KNOWN_MIME_TYPES,
  type KnownMimeType,
  tables,
} from "@runt/schema";
import {
  getBootstrapPackages as _getBootstrapPackages,
  getCacheConfig as _getCacheConfig,
  getCacheDir as _getCacheDir,
  getEssentialPackages,
  getOnDemandPackages as _getOnDemandPackages,
  getPreloadPackages as _getPreloadPackages,
  isFirstRun as _isFirstRun,
} from "./cache-utils.ts";
import {
  discoverAvailableAiModels,
  ensureTextPlainFallback,
  executeAI,
  gatherNotebookContext,
  type NotebookTool,
} from "@runt/ai";

// Temporary definitions until @runtimed/schema exports are published
interface MediaBundle {
  [mimeType: string]: unknown;
}

function validateMediaBundle(bundle: MediaBundle): MediaBundle {
  const result: MediaBundle = {};

  for (const [mimeType, value] of Object.entries(bundle)) {
    if (value == null) continue;

    if (isTextBasedMimeType(mimeType)) {
      // Text-based types should be strings
      result[mimeType] = String(value);
    } else if (isJsonMimeType(mimeType)) {
      // JSON types should be objects or properly formatted JSON strings
      if (typeof value === "object") {
        result[mimeType] = value;
      } else if (typeof value === "string") {
        try {
          result[mimeType] = JSON.parse(value);
        } catch {
          result[mimeType] = value; // Keep as string if not valid JSON
        }
      } else {
        result[mimeType] = value;
      }
    } else {
      // Keep other types as-is
      result[mimeType] = value;
    }
  }

  return result;
}

/**
 * Configuration options for PyodideRuntimeAgent
 */
interface PyodideAgentOptions {
  packages?: string[];
  discoverAiModels?: boolean;
  mountPaths?: string[];
  mountMappings?: Array<{ hostPath: string; targetPath: string }>;
  outputDir?: string;
  indexMountedFiles?: boolean;
  mountReadonly?: boolean;
}

/**
 * Runtime configuration options for PyodideRuntimeAgent
 */
interface PyodideRuntimeOptions {
  adapter?: Adapter;
  userId?: string;
  store: Store;
}

/**
 * Pyodide-based Python runtime agent using web workers
 *
 * Extends the generic RuntimeAgent with advanced Python execution capabilities
 * including IPython integration, rich display support, matplotlib output,
 * pandas HTML tables, and error formatting.
 */
export class PyodideRuntimeAgent extends RuntimeAgent {
  declare public config: PyodideRuntimeConfig;
  private worker: Worker | null = null;
  private interruptBuffer?: SharedArrayBuffer;
  private isInitialized = false;
  private currentExecutionContext: ExecutionContext | null = null;
  private executionQueue: Array<{
    context: ExecutionContext;
    code: string;
    resolve: (result: { success: boolean; error?: string }) => void;
    reject: (error: unknown) => void;
  }> = [];
  private isExecuting = false;
  private pendingExecutions = new Map<string, {
    resolve: (data: unknown) => void;
    reject: (error: unknown) => void;
  }>();
  private currentAIExecution: {
    cellId: string;
    abortController: AbortController;
  } | null = null;
  private signalHandlers = new Map<string, () => void>();
  private pyodideOptions: PyodideAgentOptions;

  /**
   * Parse log level from environment variable string
   */
  private parseLogLevel(
    levelStr: string | undefined,
  ): typeof LogLevel[keyof typeof LogLevel] {
    if (!levelStr) return LogLevel.INFO;

    const normalizedLevel = levelStr.toUpperCase();
    switch (normalizedLevel) {
      case "DEBUG":
        return LogLevel.DEBUG;
      case "INFO":
        return LogLevel.INFO;
      case "WARN":
      case "WARNING":
        return LogLevel.WARN;
      case "ERROR":
        return LogLevel.ERROR;
      default:
        return LogLevel.INFO;
    }
  }

  /**
   * Configure logger from environment variables
   * Reads RUNT_LOG_LEVEL and RUNT_DISABLE_CONSOLE_LOGS
   */
  private configureLoggerFromEnvironment(): void {
    const logLevel = this.parseLogLevel(Deno.env.get("RUNT_LOG_LEVEL"));
    const disableConsole = Deno.env.get("RUNT_DISABLE_CONSOLE_LOGS") === "true";

    logger.configure({
      level: logLevel,
      console: !disableConsole,
    });
  }

  constructor(
    args: string[] = Deno.args,
    options: PyodideAgentOptions = {},
    runtimeOptions: PyodideRuntimeOptions,
  ) {
    let config: PyodideRuntimeConfig;
    try {
      config = createPyodideRuntimeConfig(args, {
        capabilities: {
          canExecuteCode: true,
          canExecuteSql: false,
          canExecuteAi: true,
          availableAiModels: [], // Will be populated during startup
        },
        store: runtimeOptions.store,
        ...options, // Merge options into config
      });
    } catch (error) {
      // Configuration errors should still go to console for CLI usability
      console.error("❌ Configuration Error:");
      console.error(error instanceof Error ? error.message : String(error));
      console.error("\nExample usage:");
      console.error(
        '  deno run --allow-all "jsr:@runt/pyodide-runtime-agent" --notebook my-notebook --auth-token your-runt-api-key',
      );
      console.error("\nOr set environment variables in .env:");
      console.error("  NOTEBOOK_ID=my-notebook");
      console.error("  RUNT_API_KEY=your-runt-api-key");
      console.error("\nOr install globally:");
      console.error(
        "  deno install -gf --allow-all jsr:@runt/pyodide-runtime-agent",
      );
      console.error("  pyorunt --notebook my-notebook --auth-token your-token");
      Deno.exit(1);
    }

    // Store is required and should be passed in
    if (!runtimeOptions.store) {
      throw new Error("LiveStore instance is required for PyodideRuntimeAgent");
    }

    super(config, config.capabilities, {
      onStartup: async () => {
        // Pyodide-specific startup logic if needed
      },
      onShutdown: async () => {
        await this.cleanupWorker();
      },
    });

    // Configure logger from environment variables early if not already configured
    // This ensures RUNT_LOG_LEVEL is respected even when using PyodideRuntimeAgent programmatically
    if (
      Deno.env.get("RUNT_LOG_LEVEL") && logger.getLevel() === LogLevel.INFO
    ) {
      this.configureLoggerFromEnvironment();
    }

    // Store simplified options - config now handles the complex merging
    this.pyodideOptions = {
      ...options,
      discoverAiModels: options.discoverAiModels ?? true,
    };
    this.onExecution(this.executeCell.bind(this));
    this.onCancellation(this.handlePyodideCancellation.bind(this));
  }

  /**
   * Start the Pyodide runtime agent
   */
  override async start(): Promise<void> {
    logger.info("Starting Pyodide Python runtime agent");

    // Discover available AI models if enabled
    if (this.pyodideOptions.discoverAiModels !== false) {
      try {
        logger.info("Discovering available AI models...");
        const models = await discoverAvailableAiModels();
        // Update the capabilities object with discovered models
        (this.config.capabilities as RuntimeCapabilities).availableAiModels =
          models;

        if (models.length === 0) {
          logger.warn(
            "No AI models discovered - OpenAI API key or Ollama server may not be available",
          );
        } else {
          logger.info(
            `Discovered ${models.length} AI models from providers`,
          );
        }
      } catch (error) {
        logger.error("Failed to discover AI models", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // Call parent to initialize LiveStore
    await super.start();

    // Initialize Pyodide worker after logger is available
    await this.initializePyodideWorker();
  }

  /**
   * Initialize Pyodide worker with rich display support
   */
  private async initializePyodideWorker(): Promise<void> {
    try {
      logger.info("Initializing Pyodide worker");

      // Determine packages to load based on options
      const packagesToLoad = this.pyodideOptions.packages ||
        getEssentialPackages();

      logger.info("Loading packages", {
        packageCount: packagesToLoad.length,
        packages: packagesToLoad,
      });

      // Create SharedArrayBuffer for interrupt signaling
      this.interruptBuffer = new SharedArrayBuffer(4);
      const interruptView = new Int32Array(this.interruptBuffer);
      interruptView[0] = 0; // Initialize to no interrupt

      // Create worker with Pyodide
      this.worker = new Worker(
        new URL("./pyodide-worker.ts", import.meta.url),
        { type: "module" },
      );

      // Set up worker message handling
      this.worker.addEventListener(
        "message",
        this.handleWorkerMessage.bind(this),
      );
      this.worker.addEventListener("error", (error) => {
        logger.error("Worker error", {
          message: error.message || "Unknown worker error",
          filename: error.filename,
          lineno: error.lineno,
        });
        this.handleWorkerCrash("Worker error event");
      });
      this.worker.addEventListener("messageerror", (error) => {
        logger.error("Worker message error", {
          type: error.type,
          data: error.data,
        });
        this.handleWorkerCrash("Worker message error");
      });

      // Read mount directories if provided
      let mountData: Array<
        {
          hostPath: string;
          targetPath?: string;
          files: Array<{ path: string; content: Uint8Array }>;
          readonly?: boolean;
        }
      > = [];
      if (this.config.mountPaths && this.config.mountPaths.length > 0) {
        mountData = await this.readMountDirectories(
          this.config.mountPaths,
          this.config.mountMappings,
        );

        // Add readonly flag to all mount entries if mountReadonly is enabled
        if (this.config.mountReadonly) {
          mountData = mountData.map((entry) => ({ ...entry, readonly: true }));
        }

        // Start vector store ingestion asynchronously only if indexing is enabled
        if (this.config.indexMountedFiles) {
          // Initialize vector store in background to avoid blocking pyodide startup
          Promise.resolve().then(async () => {
            try {
              const { getVectorStore } = await import("@runt/ai");
              const vectorStore = getVectorStore();
              vectorStore.startIngestion(mountData);
              logger.info(
                "Vector store indexing started for mounted files",
              );
            } catch (error) {
              logger.error("Vector store ingestion failed", {
                error: String(error),
              });
            }
          });
          logger.info(
            "Vector store indexing enabled - initialization started in background",
          );
        } else {
          logger.info(
            "Vector store indexing disabled - mounted files will not be indexed for AI search",
          );
        }
      }

      // Initialize Pyodide in worker
      await this.sendWorkerMessage("init", {
        interruptBuffer: this.interruptBuffer,
        packages: packagesToLoad,
        mountData,
      });

      this.isInitialized = true;
      logger.info("Pyodide worker initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize Pyodide worker", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Send message to worker and wait for response
   */
  private sendWorkerMessage(type: string, data: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker not initialized"));
        return;
      }

      const messageId = crypto.randomUUID();
      this.pendingExecutions.set(messageId, { resolve, reject });

      this.worker.postMessage({
        id: messageId,
        type,
        data,
      });
    });
  }

  /**
   * Handle messages from worker
   */
  private handleWorkerMessage(event: MessageEvent): void {
    const { id, type, data, error } = event.data;

    if (type === "log") {
      logger.debug("Worker log", { message: data });
      return;
    }

    if (type === "startup_output") {
      // Startup messages are already logged by worker, noop to keep out of cells
      return;
    }

    if (type === "stream_output") {
      // Handle real-time streaming outputs with formatting
      if (this.currentExecutionContext) {
        switch (data.type) {
          case "stdout":
            this.currentExecutionContext.stdout(data.text);
            break;
          case "stderr":
            this.currentExecutionContext.stderr(data.text);
            break;
          case "result":
          case "execute_result":
            if (data.data !== null && data.data !== undefined) {
              this.currentExecutionContext.result(
                this.formatRichOutput(data.data, data.metadata),
              );
            }
            break;
          case "display_data":
            if (data.data !== null && data.data !== undefined) {
              // Extract display_id from transient data if present
              const displayId = data.transient?.display_id;
              this.currentExecutionContext.display(
                this.formatRichOutput(data.data, data.metadata),
                data.metadata || {},
                displayId,
              );
            }
            break;
          case "update_display_data":
            if (data.data != null) {
              // Extract display_id from transient data
              const displayId = data.transient?.display_id;
              if (displayId) {
                this.currentExecutionContext.updateDisplay(
                  displayId,
                  this.formatRichOutput(data.data, data.metadata),
                  data.metadata || {},
                );
              } else {
                // Fallback to regular display if no display_id
                this.currentExecutionContext.display(
                  this.formatRichOutput(data.data, data.metadata),
                  data.metadata || {},
                );
              }
            }
            break;
          case "error":
            this.currentExecutionContext.error(
              data.data.ename || "PythonError",
              data.data.evalue || "Unknown error",
              data.data.traceback || [String(data.data)],
            );
            break;
          case "clear_output":
            this.currentExecutionContext.clear(data.wait || false);
            break;
        }
      }
      return;
    }

    const pending = this.pendingExecutions.get(id);
    if (!pending) return;

    this.pendingExecutions.delete(id);

    if (error) {
      // Handle specific error types
      if (error.includes("KeyboardInterrupt")) {
        pending.reject(new Error("Execution cancelled"));
      } else {
        pending.reject(new Error(error));
      }
    } else {
      pending.resolve(data);
    }
  }

  /**
   * Execute Python code or AI prompts using Pyodide worker or OpenAI
   */
  public async executeCell(
    context: ExecutionContext,
  ): Promise<{ success: boolean; error?: string }> {
    const { cell } = context;
    const code = cell.source?.trim() || "";

    // When an AI cell, hand it off to `@runt/ai` to handle, providing it notebook context
    if (cell.cellType === "ai") {
      // Find the current cell reference for context gathering
      const cellReferences = this.store.query(cellReferences$);
      const currentCellRef = cellReferences.find((ref) => ref.id === cell.id);

      if (!currentCellRef) {
        throw new Error(`Could not find cell reference for cell ${cell.id}`);
      }

      const notebookContext = gatherNotebookContext(this.store, currentCellRef);

      // Track AI execution for cancellation
      const aiAbortController = new AbortController();
      this.currentAIExecution = {
        cellId: cell.id,
        abortController: aiAbortController,
      };

      // Connect the AI abort controller to the execution context's abort signal
      if (context.abortSignal.aborted) {
        aiAbortController.abort();
      } else {
        context.abortSignal.addEventListener("abort", () => {
          aiAbortController.abort();
        });
      }

      // Create a modified context with the AI-specific abort signal and bound sendWorkerMessage
      const aiContext = {
        ...context,
        abortSignal: aiAbortController.signal,
        sendWorkerMessage: this.sendWorkerMessage.bind(this),
      };

      const notebookTools = await this.sendWorkerMessage(
        "get_registered_tools",
        {},
      ) as NotebookTool[];

      try {
        const maxIterations = this.config.aiMaxIterations;

        let userSavedPrompt = this.store.query(
          tables.notebookMetadata
            .select()
            .where({ key: "user_saved_prompt" })
            .first({ fallback: () => "" }),
        );

        if (typeof userSavedPrompt !== "string") {
          userSavedPrompt = userSavedPrompt.value;
        }

        return await executeAI(
          aiContext,
          notebookContext,
          this.store,
          this.config.sessionId,
          notebookTools,
          maxIterations,
          userSavedPrompt,
        );
      } finally {
        this.currentAIExecution = null;
      }
    }

    if (!this.isInitialized || !this.worker) {
      // Try to reinitialize worker if it crashed
      try {
        await this.initializePyodideWorker();
      } catch (_initError) {
        throw new Error(
          "Pyodide worker not initialized and failed to reinitialize",
        );
      }
    }

    if (!code) {
      return { success: true };
    }

    // Queue the execution to ensure serialization
    return new Promise((resolve, reject) => {
      this.executionQueue.push({
        context,
        code,
        resolve,
        reject,
      });
      this.processExecutionQueue();
    });
  }

  /**
   * Process execution queue to ensure only one execution at a time
   */
  private async processExecutionQueue(): Promise<void> {
    if (this.isExecuting || this.executionQueue.length === 0) {
      return;
    }

    this.isExecuting = true;
    const { context, code, resolve, reject } = this.executionQueue.shift()!;

    try {
      const result = await this.executeCodeSerialized(context, code);
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.isExecuting = false;
      // Process next item in queue
      this.processExecutionQueue();
    }
  }

  /**
   * Execute code with proper context isolation
   */
  private async executeCodeSerialized(
    context: ExecutionContext,
    code: string,
  ): Promise<{ success: boolean; error?: string }> {
    const {
      stderr,
      result,
      error,
      abortSignal,
    } = context;

    try {
      // Set up abort handling
      let isAborted = false;
      const abortHandler = () => {
        isAborted = true;
        if (this.interruptBuffer) {
          const view = new Int32Array(this.interruptBuffer);
          view[0] = 2; // SIGINT
        }
      };

      if (abortSignal.aborted) {
        // TODO: Use a special display for this
        stderr("Execution was already cancelled\n");
        return { success: false, error: "Execution cancelled" };
      }

      abortSignal.addEventListener("abort", abortHandler);

      try {
        // Set current execution context for real-time streaming
        this.currentExecutionContext = context;

        const executionResult = await this.sendWorkerMessage("execute", {
          code,
        }) as { result: unknown };

        if (isAborted) {
          stderr("Python execution was cancelled\n");
          return { success: false, error: "Execution cancelled" };
        }

        // Note: Most outputs are already streamed via handleWorkerMessage
        // Only handle final result if it wasn't already streamed
        if (
          executionResult.result !== null &&
          executionResult.result !== undefined
        ) {
          result(this.formatRichOutput(executionResult.result));
        }

        // Sync /outputs directory back to host if outputDir is configured
        if (this.config.outputDir) {
          await this.syncOutputsToHost();
        }

        return { success: true };
      } finally {
        abortSignal.removeEventListener("abort", abortHandler);
        // Clear interrupt signal
        if (this.interruptBuffer) {
          const view = new Int32Array(this.interruptBuffer);
          view[0] = 0;
        }
        // Clear execution context
        this.currentExecutionContext = null;
      }
    } catch (err) {
      if (
        abortSignal.aborted ||
        (err instanceof Error &&
          (err.message.includes("cancelled") ||
            err.message.includes("KeyboardInterrupt") ||
            err.message.includes("Worker crashed")))
      ) {
        stderr("Python execution was cancelled\n");
        return { success: false, error: "Execution cancelled" };
      }

      // Handle Python errors
      if (err instanceof Error) {
        const errorLines = err.message.split("\n");
        const errorName = errorLines[0] || "PythonError";
        const errorValue = errorLines[1] || err.message;
        const traceback = errorLines.length > 2 ? errorLines : [err.message];

        error(errorName, errorValue, traceback);
        return { success: false, error: errorValue };
      }

      throw err;
    }
  }

  /**
   * Format rich output with proper MIME type handling
   */
  // Type guard for objects with string indexing
  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  // Type guard for rich data structure
  private hasDataProperty(value: unknown): value is { data: unknown } {
    return this.isRecord(value) && "data" in value;
  }

  private formatRichOutput(
    result: unknown,
    metadata?: Record<string, unknown>,
  ): MediaBundle {
    if (result === null || result === undefined) {
      return { "text/plain": "" };
    }

    // If result is already a formatted output dict with MIME types
    if (this.isRecord(result)) {
      const rawBundle: MediaBundle = {};
      let hasMimeType = false;

      // Check all known MIME types and any +json types
      for (const mimeType of Object.keys(result)) {
        if (
          KNOWN_MIME_TYPES.includes(mimeType as KnownMimeType) ||
          isJsonMimeType(mimeType)
        ) {
          const value = result[mimeType];

          // Handle different value types appropriately
          if (typeof value === "string") {
            rawBundle[mimeType] = value;
            hasMimeType = true;
          } else if (typeof value === "number" || typeof value === "boolean") {
            rawBundle[mimeType] = isTextBasedMimeType(mimeType)
              ? String(value)
              : value;
            hasMimeType = true;
          } else if (this.isRecord(value)) {
            // Keep JSON objects as objects for JSON-based types
            if (isJsonMimeType(mimeType)) {
              rawBundle[mimeType] = value;
            } else {
              rawBundle[mimeType] = JSON.stringify(value);
            }
            hasMimeType = true;
          } else if (value !== null && value !== undefined) {
            rawBundle[mimeType] = String(value);
            hasMimeType = true;
          }
        }
      }

      if (hasMimeType) {
        // Validate and ensure text/plain fallback for display
        const validated = validateMediaBundle(rawBundle);
        return ensureTextPlainFallback(validated);
      }

      // Check if it's a rich data structure with data and metadata
      if (this.hasDataProperty(result)) {
        return this.formatRichOutput(result.data, metadata);
      }

      // Format as JSON with pretty printing
      try {
        const jsonStr = JSON.stringify(result, null, 2);
        return {
          "text/plain": jsonStr,
          "application/json": result,
        };
      } catch {
        return { "text/plain": String(result) };
      }
    }

    // Handle primitive types
    if (typeof result === "string") {
      // Check if it's HTML content
      if (result.includes("<") && result.includes(">")) {
        return {
          "text/html": result,
          "text/plain": result.replace(/<[^>]*>/g, ""), // Strip HTML for plain text
        };
      }
      return { "text/plain": result };
    }

    if (typeof result === "number" || typeof result === "boolean") {
      return { "text/plain": String(result) };
    }

    return { "text/plain": String(result) };
  }

  /**
   * Handle cancellation events
   */
  private handlePyodideCancellation(
    queueId: string,
    cellId: string,
    reason: string,
  ): void {
    logger.info("Python execution cancellation", {
      queueId,
      cellId,
      reason,
    });

    // Check if this is an AI cell being cancelled
    if (this.currentAIExecution && this.currentAIExecution.cellId === cellId) {
      logger.info("Cancelling AI execution", {
        cellId,
      });
      this.currentAIExecution.abortController.abort();
      this.currentAIExecution = null;

      // For AI cells, we don't need to signal interrupt to Pyodide worker
      // or clear the execution queue since AI cells don't use the worker
      return;
    }

    // Signal interrupt to Pyodide worker (only for code cells)
    if (this.interruptBuffer) {
      const view = new Int32Array(this.interruptBuffer);
      view[0] = 2; // SIGINT
    }

    // Cancel ALL queued executions when any cell is interrupted
    // This prevents subsequent cells from running with incomplete state
    const initialQueueLength = this.executionQueue.length;

    // Reject all queued executions
    for (const item of this.executionQueue) {
      item.reject(new Error("Execution cancelled due to interrupt"));
    }

    // Clear the entire queue
    this.executionQueue.length = 0;

    if (initialQueueLength > 0) {
      logger.info("Cancelled all queued executions due to interrupt", {
        triggeringCellId: cellId,
        cancelledCount: initialQueueLength,
      });
    }
  }

  /**
   * Handle worker crash and cleanup
   */
  private handleWorkerCrash(reason: string): void {
    logger.error("Uncaught error", { error: "null" });

    // Reject all pending executions
    for (const [_id, pending] of this.pendingExecutions) {
      pending.reject(new Error(`Worker crashed: ${reason}`));
    }
    this.pendingExecutions.clear();

    // Reject all queued executions
    for (const { reject } of this.executionQueue) {
      reject(new Error(`Worker crashed: ${reason}`));
    }
    this.executionQueue.length = 0;

    // Mark as uninitialized to trigger restart
    this.isInitialized = false;
    this.currentExecutionContext = null;

    // Clean up worker (async but don't wait for it in crash handler)
    this.cleanupWorker().catch((error) => {
      logger.debug("Error during worker cleanup after crash", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /**
   * Cleanup worker resources
   */
  private async cleanupWorker(): Promise<void> {
    if (this.worker) {
      try {
        // Send shutdown signal to worker before terminating
        await this.sendWorkerMessage("shutdown", {});

        // Give the worker a moment to clean up
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        // Ignore errors during shutdown - worker might already be terminated
        logger.debug(
          "Worker shutdown message failed (expected during cleanup)",
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }

      this.worker.terminate();
      this.worker = null;
    }

    logger.info("Pyodide worker cleanup completed");
  }

  /**
   * Read directory contents recursively for mounting
   */
  private async readMountDirectories(
    mountPaths: string[],
    mountMappings?: Array<{ hostPath: string; targetPath: string }>,
  ): Promise<
    Array<
      {
        hostPath: string;
        targetPath?: string;
        files: Array<{ path: string; content: Uint8Array }>;
      }
    >
  > {
    const mountData: Array<
      {
        hostPath: string;
        targetPath?: string;
        files: Array<{ path: string; content: Uint8Array }>;
      }
    > = [];

    for (const hostPath of mountPaths) {
      try {
        const files: Array<{ path: string; content: Uint8Array }> = [];

        // Recursively read all files in the directory
        await this.readDirectoryRecursive(hostPath, hostPath, files);

        // Find the target path from mount mappings
        const targetPath = mountMappings?.find((m) => m.hostPath === hostPath)
          ?.targetPath;

        // Only include targetPath if it's defined
        const mountEntry = targetPath
          ? { hostPath, targetPath, files }
          : { hostPath, files };
        mountData.push(mountEntry);

        logger.info(
          `Read ${files.length} files from mount path: ${hostPath}${
            targetPath ? ` -> ${targetPath}` : ""
          }`,
        );
      } catch (error) {
        logger.warn(`Failed to read mount directory: ${hostPath}`, {
          error,
        });
      }
    }

    return mountData;
  }

  /**
   * Recursively read directory contents
   */
  private async readDirectoryRecursive(
    basePath: string,
    currentPath: string,
    files: Array<{ path: string; content: Uint8Array }>,
  ): Promise<void> {
    try {
      for await (const entry of Deno.readDir(currentPath)) {
        const fullPath = `${currentPath}/${entry.name}`;
        const relativePath = fullPath.replace(`${basePath}/`, "");

        if (entry.isFile) {
          try {
            const content = await Deno.readFile(fullPath);
            files.push({ path: relativePath, content });
          } catch (error) {
            logger.warn(`Failed to read file: ${fullPath}`, { error });
          }
        } else if (entry.isDirectory) {
          // Recursively read subdirectory
          await this.readDirectoryRecursive(basePath, fullPath, files);
        }
      }
    } catch (error) {
      logger.warn(`Failed to read directory: ${currentPath}`, { error });
    }
  }

  /**
   * Sync files from /outputs directory back to host filesystem
   */
  private async syncOutputsToHost(): Promise<void> {
    if (!this.config.outputDir) {
      return;
    }

    try {
      // Get files from /outputs directory via worker
      const result = await this.sendWorkerMessage("sync_outputs", {}) as {
        files: Array<{ path: string; content: Uint8Array }>;
      };

      if (!result.files || result.files.length === 0) {
        logger.debug("No files found in /outputs directory to sync");
        return;
      }

      // Ensure output directory exists on host
      try {
        await Deno.mkdir(this.config.outputDir, { recursive: true });
      } catch (_error) {
        // Directory might already exist, ignore error
      }

      // Write each file to the host filesystem
      let syncedCount = 0;
      for (const { path, content } of result.files) {
        try {
          const hostPath: string = `${this.config.outputDir}/${path}`;

          // Create parent directories if needed
          const parentDir: string = hostPath.substring(
            0,
            hostPath.lastIndexOf("/"),
          );
          if (parentDir !== this.config.outputDir) {
            try {
              await Deno.mkdir(parentDir, { recursive: true });
            } catch (_error) {
              // Directory might already exist, ignore
            }
          }

          // Write file to host
          await Deno.writeFile(hostPath, content);
          syncedCount++;
        } catch (error) {
          logger.warn(`Failed to sync file ${path} to host: ${error}`);
        }
      }

      if (syncedCount > 0) {
        logger.info(
          `Synced ${syncedCount} files from /outputs to ${this.config.outputDir}`,
        );
      }
    } catch (error) {
      logger.warn(`Failed to sync outputs to host: ${error}`);
    }
  }

  /**
   * Set up Deno-specific signal handlers
   */
  protected override setupShutdownHandlers(): void {
    // Call parent implementation for global error handlers
    super.setupShutdownHandlers();

    const shutdown = () => this.shutdown();

    // Store signal handlers for cleanup
    this.signalHandlers.set("SIGINT", shutdown);
    this.signalHandlers.set("SIGTERM", shutdown);

    // Add Deno signal listeners
    Deno.addSignalListener("SIGINT" as Deno.Signal, shutdown);
    Deno.addSignalListener("SIGTERM" as Deno.Signal, shutdown);
  }

  /**
   * Clean up Deno-specific signal handlers
   */
  protected override cleanupShutdownHandlers(): void {
    // Clean up Deno signal listeners
    for (const [signal, handler] of this.signalHandlers) {
      try {
        Deno.removeSignalListener(signal as Deno.Signal, handler);
      } catch (error) {
        // Ignore errors during cleanup
        logger.debug("Error removing signal listener", {
          signal,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.signalHandlers.clear();

    // Call parent implementation
    super.cleanupShutdownHandlers();
  }
}

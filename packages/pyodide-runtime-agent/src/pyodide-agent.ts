// Pyodide Runtime Agent
//
// This module provides a Pyodide-based Python runtime agent with advanced
// IPython integration, rich display support, and true interruption support
// via Pyodide's built-in interrupt system.

import {
  createRuntimeConfig,
  RuntimeAgent,
  type RuntimeConfig,
} from "@runt/lib";
import type { ExecutionContext } from "@runt/lib";
import { createLogger } from "@runt/lib";
import { type MediaBundle, validateMediaBundle } from "@runt/lib";
import {
  isJsonMimeType,
  isTextBasedMimeType,
  KNOWN_MIME_TYPES,
  type KnownMimeType,
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

/**
 * Configuration options for PyodideRuntimeAgent
 */
interface PyodideAgentOptions {
  packages?: string[];
  discoverAiModels?: boolean;
}

/**
 * Pyodide-based Python runtime agent using web workers
 *
 * Extends the generic RuntimeAgent with advanced Python execution capabilities
 * including IPython integration, rich display support, matplotlib output,
 * pandas HTML tables, and error formatting.
 */
export class PyodideRuntimeAgent extends RuntimeAgent {
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
  private currentAIExecution: {
    cellId: string;
    abortController: AbortController;
  } | null = null;
  private pendingExecutions = new Map<string, {
    resolve: (result: unknown) => void;
    reject: (error: unknown) => void;
  }>();
  private logger = createLogger("pyodide-agent");
  private options: PyodideAgentOptions;

  constructor(args: string[] = Deno.args, options: PyodideAgentOptions = {}) {
    let config: RuntimeConfig;
    try {
      config = createRuntimeConfig(args, {
        runtimeType: "python3-pyodide",
        capabilities: {
          canExecuteCode: true,
          canExecuteSql: false,
          canExecuteAi: true,
          availableAiModels: [], // Will be populated during startup
        },
      });
    } catch (error) {
      // Configuration errors should still go to console for CLI usability
      console.error("❌ Configuration Error:");
      console.error(error instanceof Error ? error.message : String(error));
      console.error("\nExample usage:");
      console.error(
        '  deno run --allow-all "jsr:@runt/pyodide-runtime-agent" --notebook my-notebook --auth-token your-token',
      );
      console.error("\nOr set environment variables in .env:");
      console.error("  NOTEBOOK_ID=my-notebook");
      console.error("  AUTH_TOKEN=your-token");
      console.error("\nOr install globally:");
      console.error(
        "  deno install -gf --allow-all jsr:@runt/pyodide-runtime-agent",
      );
      console.error("  pyorunt --notebook my-notebook --auth-token your-token");
      Deno.exit(1);
    }

    super(config, config.capabilities, {
      onStartup: async () => {
        await this.initializePyodideWorker();
      },
      onShutdown: () => {
        this.cleanupWorker();
      },
    });

    this.options = options;
    this.onExecution(this.executeCell.bind(this));
    this.onCancellation(this.handlePyodideCancellation.bind(this));
  }

  /**
   * Start the Pyodide runtime agent
   */
  override async start(): Promise<void> {
    this.logger.info("Starting Pyodide Python runtime agent");

    // Discover available AI models if enabled
    if (this.options.discoverAiModels !== false) {
      try {
        this.logger.info("Discovering available AI models...");
        const models = await discoverAvailableAiModels();
        this.config.capabilities.availableAiModels = models;

        if (models.length === 0) {
          this.logger.warn(
            "No AI models discovered - OpenAI API key or Ollama server may not be available",
          );
        } else {
          this.logger.info(
            `Discovered ${models.length} AI models from providers`,
          );
        }
      } catch (_error) {
        this.logger.warn(
          "AI model discovery failed - AI features will be limited",
        );
      }
    }

    await super.start();
  }

  /**
   * Initialize Pyodide worker with rich display support
   */
  private async initializePyodideWorker(): Promise<void> {
    try {
      this.logger.info("Initializing Pyodide worker");

      // Determine packages to load based on options
      const packagesToLoad = this.options.packages || getEssentialPackages();

      this.logger.info("Loading packages", {
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
        this.logger.error("Worker error", { error });
        this.handleWorkerCrash("Worker error event");
      });
      this.worker.addEventListener("messageerror", (error) => {
        this.logger.error("Worker message error", { error });
        this.handleWorkerCrash("Worker message error");
      });

      // Initialize Pyodide in worker
      await this.sendWorkerMessage("init", {
        interruptBuffer: this.interruptBuffer,
        packages: packagesToLoad,
      });

      this.isInitialized = true;
      this.logger.info("Pyodide worker initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize Pyodide worker", error);
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
      this.logger.debug("Worker log", { message: data });
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
      const notebookContext = gatherNotebookContext(this.store, cell);

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
        return await executeAI(
          aiContext,
          notebookContext,
          this.logger,
          this.store,
          this.config.sessionId,
          notebookTools,
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
    this.logger.info("Python execution cancellation", {
      queueId,
      cellId,
      reason,
    });

    // Check if this is an AI cell being cancelled
    if (this.currentAIExecution && this.currentAIExecution.cellId === cellId) {
      this.logger.info("Cancelling AI execution", {
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
      this.logger.info("Cancelled all queued executions due to interrupt", {
        triggeringCellId: cellId,
        cancelledCount: initialQueueLength,
      });
    }
  }

  /**
   * Handle worker crash and cleanup
   */
  private handleWorkerCrash(reason: string): void {
    this.logger.error("Uncaught error", { error: "null" });

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

    // Clean up worker
    this.cleanupWorker();
  }

  /**
   * Cleanup worker resources
   */
  private cleanupWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.logger.info("Pyodide worker cleanup completed");
  }
}

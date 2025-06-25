// Enhanced Pyodide Runtime Agent
//
// This module provides a Pyodide-based Python runtime agent with advanced
// IPython integration, rich display support, and true interruption support
// via Pyodide's built-in interrupt system.

import { createRuntimeConfig, RuntimeAgent } from "@runt/lib";
import type { ExecutionContext } from "@runt/lib";
import { createLogger } from "@runt/lib";
import {
  ensureTextPlainFallback,
  isJsonMimeType,
  isTextBasedMimeType,
  KNOWN_MIME_TYPES,
  type KnownMimeType,
  type MediaBundle,
  toAIMediaBundle,
  validateMediaBundle,
} from "@runt/lib";
import { getEssentialPackages } from "./cache-utils.ts";
import type { Store } from "npm:@livestore/livestore";
import {
  type CellData,
  events,
  type OutputData as SchemaOutputData,
  schema,
  tables,
} from "@runt/schema";
import { OpenAIClient } from "./openai-client.ts";
import stripAnsi from "npm:strip-ansi";

/**
 * Type definitions for AI context generation - exported for reuse in other runtime agents
 */
export interface CellContextData {
  id: string;
  cellType: string;
  source: string;
  position: number;
  outputs: Array<{
    outputType: string;
    data: Record<string, unknown>;
  }>;
}

export interface NotebookContextData {
  previousCells: CellContextData[];
  totalCells: number;
  currentCellPosition: number;
}

/**
 * Configuration options for PyodideRuntimeAgent
 */
export interface PyodideAgentOptions {
  /** Custom package list to load (overrides default essential packages) */
  packages?: string[];
}

/**
 * Enhanced Pyodide-based Python runtime agent using web workers
 *
 * Extends the generic RuntimeAgent with advanced Python execution capabilities
 * including IPython integration, rich display support, matplotlib SVG output,
 * pandas HTML tables, and enhanced error formatting.
 */
export class PyodideRuntimeAgent {
  private agent: RuntimeAgent;
  private worker: Worker | null = null;
  private interruptBuffer?: SharedArrayBuffer;
  private isInitialized = false;
  private currentExecutionContext: ExecutionContext | null = null;
  private pendingExecutions = new Map<string, {
    resolve: (result: unknown) => void;
    reject: (error: unknown) => void;
  }>();
  private logger = createLogger("pyodide-agent");
  public config: ReturnType<typeof createRuntimeConfig>;
  private options: PyodideAgentOptions;
  private openaiClient: OpenAIClient | null = null;

  constructor(args: string[] = Deno.args, options: PyodideAgentOptions = {}) {
    try {
      this.config = createRuntimeConfig(args, {
        kernelType: "python3-pyodide",
        capabilities: {
          canExecuteCode: true,
          canExecuteSql: false,
          canExecuteAi: true,
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
      console.error("  pyrunt --notebook my-notebook --auth-token your-token");
      Deno.exit(1);
    }

    this.agent = new RuntimeAgent(this.config, this.config.capabilities, {
      onStartup: this.initializePyodideWorker.bind(this),
      onShutdown: this.cleanupWorker.bind(this),
    });

    this.options = options;
    this.agent.onExecution(this.executePython.bind(this));
    this.agent.onCancellation(this.handleCancellation.bind(this));
  }

  /**
   * Start the Pyodide runtime agent
   */
  async start(): Promise<void> {
    this.logger.info("Starting Pyodide Python runtime agent");
    await this.agent.start();
  }

  /**
   * Shutdown the runtime agent
   */
  async shutdown(): Promise<void> {
    await this.agent.shutdown();
  }

  /**
   * Keep the agent alive
   */
  async keepAlive(): Promise<void> {
    await this.agent.keepAlive();
  }

  /**
   * Get the LiveStore instance (for testing)
   */
  get store(): Store<typeof schema> {
    return this.agent.liveStore;
  }

  /**
   * Initialize enhanced Pyodide worker with rich display support
   */
  private async initializePyodideWorker(): Promise<void> {
    try {
      this.logger.info("Initializing enhanced Pyodide worker");

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

      // Create worker with enhanced Pyodide
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
        this.logger.error("Worker error", error);
      });

      // Initialize enhanced Pyodide in worker
      await this.sendWorkerMessage("init", {
        interruptBuffer: this.interruptBuffer,
        packages: packagesToLoad,
      });

      this.isInitialized = true;
      this.logger.info("Enhanced Pyodide worker initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize enhanced Pyodide worker", error);
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

    if (type === "stream_output") {
      // Handle real-time streaming outputs with enhanced formatting
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
              this.currentExecutionContext.display(
                this.formatRichOutput(data.data, data.metadata),
                data.metadata || {},
              );
            }
            break;
          case "update_display_data":
            if (data.data != null) {
              // Handle display updates - could extend ExecutionContext to support this
              this.currentExecutionContext.display(
                this.formatRichOutput(data.data, data.metadata),
                data.metadata
                  ? { ...data.metadata, update: true }
                  : { update: true },
              );
            }
            break;
          case "error":
            this.currentExecutionContext.error(
              data.data.ename || "PythonError",
              data.data.evalue || "Unknown error",
              data.data.traceback || [String(data.data)],
            );
            break;
        }
      }
      return;
    }

    const pending = this.pendingExecutions.get(id);
    if (!pending) return;

    this.pendingExecutions.delete(id);

    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(data);
    }
  }

  /**
   * Execute Python code or AI prompts using Pyodide worker or OpenAI
   */
  private async executePython(context: ExecutionContext) {
    const {
      cell,
      stderr,
      result,
      error,
      abortSignal,
    } = context;
    const code = cell.source?.trim() || "";

    // Handle AI cells differently
    if (cell.cellType === "ai") {
      return this.executeAI(context);
    }

    if (!this.isInitialized || !this.worker) {
      throw new Error("Pyodide worker not initialized");
    }

    if (!code) {
      return { success: true };
    }

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
        stderr("🛑 Execution was already cancelled\n");
        return { success: false, error: "Execution cancelled" };
      }

      abortSignal.addEventListener("abort", abortHandler);

      try {
        // Set current execution context for real-time streaming
        this.currentExecutionContext = context;

        // Execute Python code in worker - outputs stream in real-time
        const executionResult = await this.sendWorkerMessage("execute", {
          code,
        }) as { result: unknown };

        if (isAborted) {
          stderr("🛑 Python execution was cancelled\n");
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
        (err instanceof Error && err.message.includes("cancelled"))
      ) {
        stderr("🛑 Python execution was cancelled\n");
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
        // Validate and ensure text/plain fallback
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
  private handleCancellation(
    queueId: string,
    cellId: string,
    reason: string,
  ): void {
    this.logger.info("Python execution cancellation", {
      queueId,
      cellId,
      reason,
    });

    // Signal interrupt to Pyodide worker
    if (this.interruptBuffer) {
      const view = new Int32Array(this.interruptBuffer);
      view[0] = 2; // SIGINT
    }
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

  /**
   * Execute AI prompts using OpenAI
   */
  private async executeAI(context: ExecutionContext) {
    const {
      cell,
      stderr,
      result,
      error,
      abortSignal,
    } = context;
    const prompt = cell.source?.trim() || "";

    if (!prompt) {
      return { success: true };
    }

    try {
      if (abortSignal.aborted) {
        stderr("🛑 AI execution was already cancelled\n");
        return { success: false, error: "Execution cancelled" };
      }

      this.logger.info("Executing AI prompt", {
        cellId: cell.id,
        provider: cell.aiProvider || "openai",
        model: cell.aiModel || "gpt-4o-mini",
        promptLength: prompt.length,
      });

      // Gather notebook context for AI awareness
      const context_data = await this.gatherNotebookContext(cell);
      this.logger.info("Gathered notebook context", {
        previousCells: context_data.previousCells.length,
        totalCells: context_data.totalCells,
      });

      // Use real OpenAI API if configured, otherwise fall back to mock
      // Initialize OpenAI client on demand for AI cells only
      if (!this.openaiClient) {
        this.openaiClient = new OpenAIClient();
      }

      if (
        this.openaiClient.isReady() &&
        (cell.aiProvider === "openai" || !cell.aiProvider)
      ) {
        // Use conversation-based approach for better AI interaction
        const conversationMessages = this.buildConversationMessages(
          context_data,
          prompt,
        );

        const outputs = await this.openaiClient.generateResponseWithMessages(
          conversationMessages,
          {
            model: cell.aiModel || "gpt-4o-mini",
            provider: cell.aiProvider || "openai",
            enableTools: true,
            currentCellId: cell.id,
            onToolCall: async (toolCall) => {
              this.logger.info("AI requested tool call", {
                toolName: toolCall.name,
                cellId: cell.id,
              });
              await this.handleToolCall(cell, toolCall);
            },
          },
        );

        this.logger.info("Generated AI outputs", { count: outputs.length });

        // Send outputs to execution context
        outputs.forEach((output) => {
          if (output.type === "display_data") {
            context.display(output.data, output.metadata || {});
          } else if (output.type === "execute_result") {
            result(output.data);
          } else if (output.type === "error" && output.data) {
            const errorData = output.data as {
              ename?: string;
              evalue?: string;
              traceback?: string[];
            };
            error(
              errorData.ename || "AIError",
              errorData.evalue || "Unknown error",
              errorData.traceback || ["Unknown error"],
            );
          }
        });
      } else {
        // Show helpful configuration message when AI is not configured
        const configMessage = `# AI Configuration Required

AI has not been configured for this runtime yet. To use AI Cells, you need to set an \`OPENAI_API_KEY\` before starting your runtime agent.

## Setup Instructions

Set your API key as an environment variable:

\`\`\`bash
OPENAI_API_KEY=your-api-key-here deno run --allow-all your-script.ts
\`\`\`

Or add it to your \`.env\` file:

\`\`\`
OPENAI_API_KEY=your-api-key-here
\`\`\`

## Get an API Key

1. Visit [OpenAI's website](https://platform.openai.com/api-keys)
2. Create an account or sign in
3. Generate a new API key
4. Copy the key and use it in your environment

Once configured, your AI cells will work with real OpenAI models!`;

        context.display({
          "text/markdown": configMessage,
          "text/plain": configMessage.replace(/[#*`]/g, "").replace(
            /\n+/g,
            "\n",
          ).trim(),
        }, {
          "anode/ai_config_help": true,
        });
      }

      return { success: true };
    } catch (err) {
      if (
        abortSignal.aborted ||
        (err instanceof Error && err.message.includes("cancelled"))
      ) {
        stderr("🛑 AI execution was cancelled\n");
        return { success: false, error: "Execution cancelled" };
      }

      // Handle AI errors
      if (err instanceof Error) {
        const errorLines = err.message.split("\n");
        const errorName = errorLines[0] || "AIError";
        const errorValue = errorLines[1] || err.message;
        const traceback = errorLines.length > 2 ? errorLines : [err.message];

        error(errorName, errorValue, traceback);
        return { success: false, error: errorValue };
      }

      throw err;
    }
  }

  /**
   * Gather context from previous cells for AI execution
   */
  public gatherNotebookContext(currentCell: CellData): NotebookContextData {
    // Query all cells that come before the current cell AND are visible to AI
    const allCells = this.store.query(
      tables.cells.select().orderBy("position", "asc"),
    ) as CellData[];

    const previousCells = allCells
      .filter((cell: CellData) =>
        cell.position < currentCell.position &&
        cell.aiContextVisible !== false
      )
      .map((cell: CellData) => {
        // Get outputs for each cell
        const outputs = this.store.query(
          tables.outputs
            .select()
            .where({ cellId: cell.id })
            .orderBy("position", "asc"),
        ) as SchemaOutputData[];

        // Convert outputs to AI-friendly formats
        const filteredOutputs = outputs.map((output: SchemaOutputData) => {
          const outputData = output.data;

          if (outputData && typeof outputData === "object") {
            // For rich media outputs, convert to AI-friendly bundle
            if (
              outputData["text/plain"] || outputData["text/html"] ||
              outputData["text/markdown"] || outputData["application/json"]
            ) {
              const aiBundle = toAIMediaBundle(outputData as MediaBundle);
              return {
                outputType: output.outputType,
                data: aiBundle,
              };
            }

            // For stream outputs, include the text directly
            if (outputData.text && outputData.name) {
              return {
                outputType: output.outputType,
                data: {
                  text: outputData.text,
                  name: outputData.name,
                },
              };
            }

            // For error outputs, include error info
            if (outputData.ename && outputData.evalue) {
              return {
                outputType: output.outputType,
                data: {
                  ename: outputData.ename,
                  evalue: outputData.evalue,
                  traceback: outputData.traceback || [],
                },
              };
            }
          }

          return {
            outputType: output.outputType,
            data: outputData as Record<string, unknown>,
          };
        });

        return {
          id: cell.id,
          cellType: cell.cellType,
          source: cell.source || "",
          position: cell.position,
          outputs: filteredOutputs,
        };
      });

    return {
      previousCells,
      totalCells: allCells.length,
      currentCellPosition: currentCell.position,
    };
  }

  /**
   * Build system prompt with notebook context (legacy method)
   * @deprecated Use buildConversationMessages for better AI interaction
   */
  public buildSystemPromptWithContext(context: NotebookContextData): string {
    let systemPrompt =
      `You are a helpful AI assistant in a Jupyter-like notebook environment. You have access to the context of previous cells in the notebook.

**Notebook Context:**
- Total cells: ${context.totalCells}
- Current cell position: ${context.currentCellPosition}
- Previous cells visible to AI: ${context.previousCells.length}

**Previous Cell Contents (only cells marked as visible to AI):**
`;

    if (context.previousCells.length === 0) {
      systemPrompt +=
        "No previous cells are visible to AI in this notebook (either no previous cells exist or they have been hidden from AI context).\n";
    } else {
      context.previousCells.forEach((cell, index) => {
        systemPrompt += `
Cell ${index + 1} (Position ${cell.position}, Type: ${cell.cellType}):
\`\`\`${cell.cellType === "code" ? "python" : cell.cellType}
${cell.source}
\`\`\`
`;

        // Include outputs if they exist
        if (cell.outputs && cell.outputs.length > 0) {
          systemPrompt += `
Output:
`;
          cell.outputs.forEach((output) => {
            if (output.outputType === "stream") {
              // Handle stream outputs (stdout/stderr)
              if (output.data.text && typeof output.data.text === "string") {
                systemPrompt += `\`\`\`
${this.stripAnsi(output.data.text)}
\`\`\`
`;
              }
            } else if (output.outputType === "error") {
              // Handle error outputs
              if (
                output.data.ename && typeof output.data.ename === "string" &&
                output.data.evalue && typeof output.data.evalue === "string"
              ) {
                systemPrompt += `\`\`\`
Error: ${this.stripAnsi(output.data.ename)}: ${
                  this.stripAnsi(output.data.evalue)
                }
\`\`\`
`;
              }
            } else if (
              output.outputType === "execute_result" ||
              output.outputType === "display_data"
            ) {
              // Handle rich outputs
              if (
                output.data["text/plain"] &&
                typeof output.data["text/plain"] === "string"
              ) {
                systemPrompt += `\`\`\`
${this.stripAnsi(output.data["text/plain"])}
\`\`\`
`;
              }
              if (output.data["text/markdown"]) {
                systemPrompt += `
${output.data["text/markdown"]}
`;
              }
            }
          });
        }
      });
    }

    systemPrompt += `
**Instructions:**
- Provide clear, concise responses and include code examples when appropriate
- Reference previous cells when relevant to provide context-aware assistance
- If you see variables, functions, or data structures defined in previous cells, you can reference them
- You can see the outputs from previous code executions to understand the current state
- Help with debugging, optimization, or extending the existing code
- Suggest next steps based on the notebook's progression`;

    return systemPrompt;
  }

  /**
   * Convert notebook context to conversation messages for more natural AI interaction
   */
  public buildConversationMessages(
    context: NotebookContextData,
    userPrompt: string,
  ): Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> {
    const messages = [];

    // Clean, focused system prompt
    messages.push({
      role: "system" as const,
      content:
        `You are a helpful AI assistant in a Jupyter-like notebook environment. You can see the context of previous cells and their outputs.

**Your primary functions:**

1. **Create cells immediately** - When users want code, examples, or implementations, use the create_cell tool to add them to the notebook. Don't provide code blocks in markdown - create actual executable cells.

2. **Context awareness** - Reference previous cells and their outputs to provide relevant assistance. You can see what variables exist, what functions were defined, and what the current state is.

3. **Debug and optimize** - Help users debug errors, optimize code, or extend existing functionality based on what you can see in the notebook.

4. **Interpret outputs** - Respond based on execution results, error messages, plots, and data outputs from previous cells.

**Key behaviors:**
- CREATE cells instead of describing code
- Reference previous work when relevant
- Help debug based on actual errors you can see
- Suggest next steps based on notebook progression
- Use "after_current" positioning by default
- When using modify_cell or execute_cell tools, use the actual cell ID (shown as "ID: cell-xxx") not position numbers

Remember: Users want working code in their notebook, not explanations about code.`,
    });

    // Convert notebook history to conversation messages
    if (context.previousCells.length > 0) {
      // Add notebook context as a structured user message
      let contextMessage = `Here's the current state of my notebook:\n\n`;

      context.previousCells.forEach((cell, index) => {
        if (cell.cellType === "code") {
          contextMessage += `**Code cell ${
            index + 1
          } (ID: ${cell.id}):**\n\`\`\`python\n${cell.source}\n\`\`\`\n`;

          // Add outputs in a natural way
          if (cell.outputs && cell.outputs.length > 0) {
            contextMessage += `Output:\n`;
            cell.outputs.forEach((output) => {
              if (output.outputType === "stream" && output.data.text) {
                contextMessage += `\`\`\`\n${
                  this.stripAnsi(String(output.data.text))
                }\`\`\`\n`;
              } else if (
                output.outputType === "error" && output.data.ename &&
                output.data.evalue
              ) {
                contextMessage += `\`\`\`\nError: ${
                  this.stripAnsi(String(output.data.ename))
                }: ${this.stripAnsi(String(output.data.evalue))}\n\`\`\`\n`;
              } else if (
                (output.outputType === "execute_result" ||
                  output.outputType === "display_data") &&
                output.data["text/plain"]
              ) {
                contextMessage += `\`\`\`\n${
                  this.stripAnsi(String(output.data["text/plain"]))
                }\n\`\`\`\n`;
              }
              if (output.data["text/markdown"]) {
                contextMessage += `${output.data["text/markdown"]}\n`;
              }
            });
          }
          contextMessage += `\n`;
        } else if (cell.cellType === "ai") {
          // Show previous AI interactions as assistant messages
          contextMessage +=
            `**Previous AI response (ID: ${cell.id}):**\n${cell.source}\n\n`;
        } else if (cell.cellType === "markdown") {
          contextMessage +=
            `**Markdown (ID: ${cell.id}):**\n${cell.source}\n\n`;
        }
      });

      messages.push({
        role: "user" as const,
        content: contextMessage,
      });
    }

    // Add the current user prompt
    messages.push({
      role: "user" as const,
      content: userPrompt,
    });

    return messages;
  }

  /**
   * Handle tool calls from AI
   */
  public handleToolCall(currentCell: CellData, toolCall: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }): void {
    const { name, arguments: args } = toolCall;

    switch (name) {
      case "create_cell": {
        const cellType = String(args.cellType || "code");
        const content = String(args.content || "");
        const position = String(args.position || "after_current");

        // Calculate position for new cell
        const newPosition = this.calculateNewCellPosition(
          currentCell,
          position,
        );

        // Generate unique cell ID
        const newCellId = `cell-${Date.now()}-${
          Math.random().toString(36).slice(2)
        }`;

        this.logger.info("Creating cell via AI tool call", {
          cellType,
          position: newPosition,
          contentLength: content.length,
        });

        // Create the new cell
        this.store.commit(
          events.cellCreated({
            id: newCellId,
            cellType: cellType as "code" | "markdown" | "raw" | "sql" | "ai",
            position: newPosition,
            createdBy: `ai-assistant-${this.config.sessionId}`,
          }),
        );

        // Set the cell source if provided
        if (content.length > 0) {
          this.store.commit(
            events.cellSourceChanged({
              id: newCellId,
              source: content,
              modifiedBy: `ai-assistant-${this.config.sessionId}`,
            }),
          );
        }

        this.logger.info("Created cell successfully", {
          cellId: newCellId,
          contentPreview: content.slice(0, 100),
        });
        break;
      }

      case "modify_cell": {
        const cellId = String(args.cellId || "");
        const content = String(args.content || "");

        if (!cellId) {
          this.logger.error("modify_cell: cellId is required");
          return;
        }

        // Check if cell exists
        const existingCell = this.store.query(
          tables.cells.select().where({ id: cellId }),
        )[0];

        if (!existingCell) {
          this.logger.error("modify_cell: Cell not found", { cellId });
          return;
        }

        this.logger.info("Modifying cell via AI tool call", {
          cellId,
          contentLength: content.length,
        });

        // Update the cell source
        this.store.commit(
          events.cellSourceChanged({
            id: cellId,
            source: content,
            modifiedBy: `ai-assistant-${this.config.sessionId}`,
          }),
        );

        this.logger.info("Modified cell successfully", {
          cellId,
          contentPreview: content.slice(0, 100),
        });
        break;
      }

      case "execute_cell": {
        const cellId = String(args.cellId || "");

        if (!cellId) {
          this.logger.error("execute_cell: cellId is required");
          return;
        }

        // Check if cell exists and is executable
        const existingCell = this.store.query(
          tables.cells.select().where({ id: cellId }),
        )[0];

        if (!existingCell) {
          this.logger.error("execute_cell: Cell not found", { cellId });
          return;
        }

        if (existingCell.cellType !== "code") {
          this.logger.error("execute_cell: Only code cells can be executed", {
            cellId,
            cellType: existingCell.cellType,
          });
          return;
        }

        this.logger.info("Executing cell via AI tool call", { cellId });

        // Request execution for the cell
        this.store.commit(
          events.executionRequested({
            queueId: `exec-${Date.now()}-${
              Math.random().toString(36).slice(2)
            }`,
            cellId,
            executionCount: (existingCell.executionCount || 0) + 1,
            requestedBy: `ai-assistant-${this.config.sessionId}`,
            priority: 1,
          }),
        );

        this.logger.info("Requested execution for cell", { cellId });
        break;
      }

      default:
        this.logger.warn("Unknown AI tool", { toolName: name });
    }
  }

  /**
   * Calculate new cell position based on placement preference
   */
  private calculateNewCellPosition(
    currentCell: CellData,
    placement: string,
  ): number {
    const allCells = this.store.query(
      tables.cells.select().orderBy("position", "asc"),
    ) as CellData[];

    switch (placement) {
      case "before_current":
        return currentCell.position - 0.1;
      case "at_end": {
        const maxPosition = allCells.length > 0
          ? Math.max(...allCells.map((c: CellData) => c.position))
          : 0;
        return maxPosition + 1;
      }
      case "after_current":
      default:
        return currentCell.position + 0.1;
    }
  }

  /**
   * Strip ANSI escape codes from text for AI consumption
   */
  private stripAnsi(text: string): string {
    return stripAnsi(text);
  }
}

/**
 * Main function to run the Pyodide runtime agent
 */
async function main() {
  const agent = new PyodideRuntimeAgent();
  const logger = createLogger("pyodide-main");

  try {
    await agent.start();

    logger.info("Pyodide runtime agent started", {
      kernelId: agent.config.kernelId,
      kernelType: agent.config.kernelType,
      notebookId: agent.config.notebookId,
      sessionId: agent.config.sessionId,
      syncUrl: agent.config.syncUrl,
      heartbeatInterval: agent.config.heartbeatInterval,
    });

    await agent.keepAlive();
  } catch (error) {
    logger.error("Failed to start Pyodide agent", error);
    Deno.exit(1);
  } finally {
    await agent.shutdown();
  }
}

// Run as script if this file is executed directly
if (import.meta.main) {
  await main();
}

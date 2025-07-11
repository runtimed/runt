// AIPython Runtime Agent - AI-powered Python execution simulation
//
// This agent uses AI to simulate IPython execution by providing the AI with
// tools that are directly connected to the execution context output methods.

import { createLogger, createRuntimeConfig, RuntimeAgent } from "@runt/lib";
import type { ExecutionContext, ExecutionResult } from "@runt/lib";
import { tables } from "@runt/schema";

interface AIPythonConfig {
  /** AI model to use for Python simulation */
  model: string;
  /** API key for the AI service */
  apiKey: string;
  /** Maximum conversation history to send */
  maxHistoryLength: number;
  /** Whether to include outputs in history */
  includeOutputs: boolean;
}

interface ConversationEntry {
  type: "code" | "output";
  content: string;
  timestamp: Date;
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

export class AIPythonAgent {
  private agent: RuntimeAgent;
  private config: AIPythonConfig;
  private logger = createLogger("aipython-agent");
  private conversationHistory: ConversationEntry[] = [];

  constructor(aiConfig: Partial<AIPythonConfig> = {}) {
    // Create runtime config from CLI args and environment
    let runtimeConfig;
    try {
      runtimeConfig = createRuntimeConfig(Deno.args, {
        runtimeType: "aipython",
        capabilities: {
          canExecuteCode: true,
          canExecuteSql: false,
          canExecuteAi: false, // This IS the AI, but doesn't expose AI cells
        },
      });
    } catch (error) {
      console.error("❌ Configuration Error:");
      console.error(error instanceof Error ? error.message : String(error));
      console.error("\nExample usage:");
      console.error(
        "  deno run --allow-all --env-file=.env aipython-agent.ts --notebook my-notebook --auth-token your-token",
      );
      console.error("\nOr set environment variables:");
      console.error("  NOTEBOOK_ID=my-notebook");
      console.error("  AUTH_TOKEN=your-token");
      console.error("  OPENAI_API_KEY=your-openai-key");
      Deno.exit(1);
    }

    // AI configuration with defaults
    this.config = {
      model: aiConfig.model || Deno.env.get("AIPYTHON_MODEL") || "gpt-4o-mini",
      apiKey: aiConfig.apiKey || Deno.env.get("OPENAI_API_KEY") || "",
      maxHistoryLength: aiConfig.maxHistoryLength || 20,
      includeOutputs: aiConfig.includeOutputs ?? true,
      ...aiConfig,
    };

    if (!this.config.apiKey) {
      console.error(
        "❌ Missing API key. Set OPENAI_API_KEY environment variable.",
      );
      Deno.exit(1);
    }

    // Create the runtime agent
    this.agent = new RuntimeAgent(runtimeConfig, runtimeConfig.capabilities, {
      onStartup: () => this.logger.info("AIPython agent starting"),
      onConnected: () => this.logger.info("Connected to LiveStore"),
      onShutdown: () => this.logger.info("AIPython agent shutting down"),
      onExecutionError: (error: Error, context: ExecutionContext) => {
        this.logger.error("Execution error", error, {
          cellId: context.cell.id,
        });
      },
    });

    // Register execution handler
    this.agent.onExecution(this.executeCode.bind(this));
  }

  async start() {
    await this.agent.start();
    this.logger.info("AIPython agent started successfully");
  }

  async shutdown() {
    await this.agent.shutdown();
  }

  async keepAlive() {
    return this.agent.keepAlive();
  }

  private async executeCode(
    context: ExecutionContext,
  ): Promise<ExecutionResult> {
    const { cell } = context;
    const code = cell.source?.trim() || "";

    if (!code) {
      return { success: true };
    }

    try {
      // Add the current code to conversation history
      this.conversationHistory.push({
        type: "code",
        content: code,
        timestamp: new Date(),
      });

      // Build conversation context for the AI
      const conversationContext = this.buildConversationContext();

      // Send to AI for Python simulation with tools
      const success = await this.queryAIWithTools(
        code,
        conversationContext,
        context,
      );

      if (success) {
        // Trim history if too long
        this.trimConversationHistory();
        return { success: true };
      } else {
        return { success: false, error: "AI execution failed" };
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      this.logger.error("AIPython execution error", err);

      context.error("AIPythonError", errorMsg, [
        "Error during AI Python simulation",
        errorMsg,
      ]);

      return { success: false, error: errorMsg };
    }
  }

  private buildConversationContext(): string {
    if (this.conversationHistory.length === 0) {
      return "";
    }

    const recentHistory = this.conversationHistory.slice(
      -this.config.maxHistoryLength,
    );
    const contextParts: string[] = [];

    for (const entry of recentHistory) {
      if (entry.type === "code") {
        contextParts.push(
          `In [${contextParts.length / 2 + 1}]: ${entry.content}`,
        );
      } else if (entry.type === "output" && this.config.includeOutputs) {
        contextParts.push(
          `Out[${Math.floor(contextParts.length / 2) + 1}]: ${entry.content}`,
        );
      }
    }

    return contextParts.join("\n\n");
  }

  private getIPythonTools(): OpenAITool[] {
    return [
      {
        type: "function",
        function: {
          name: "stdout",
          description: "Write text to stdout stream (like print() output)",
          parameters: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description: "Text to write to stdout",
              },
            },
            required: ["text"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "stderr",
          description: "Write text to stderr stream (for warnings and errors)",
          parameters: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description: "Text to write to stderr",
              },
            },
            required: ["text"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "execute_result",
          description:
            "Return the result of an expression (like IPython Out[n])",
          parameters: {
            type: "object",
            properties: {
              data: {
                type: "object",
                description: "Output data in various MIME types",
                properties: {
                  "text/plain": { type: "string" },
                  "text/html": { type: "string" },
                  "application/json": { type: "object" },
                  "image/png": { type: "string" },
                  "image/svg+xml": { type: "string" },
                },
              },
              metadata: {
                type: "object",
                description: "Optional metadata for the output",
              },
            },
            required: ["data"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "display",
          description:
            "Display rich content (like matplotlib plots, HTML, etc.)",
          parameters: {
            type: "object",
            properties: {
              data: {
                type: "object",
                description: "Display data in various MIME types",
                properties: {
                  "text/plain": { type: "string" },
                  "text/html": { type: "string" },
                  "text/markdown": { type: "string" },
                  "application/json": { type: "object" },
                  "image/png": { type: "string" },
                  "image/svg+xml": { type: "string" },
                  "application/vnd.plotly.v1+json": { type: "object" },
                },
              },
              metadata: {
                type: "object",
                description: "Optional metadata for the display",
              },
            },
            required: ["data"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "error",
          description: "Report a Python error with traceback",
          parameters: {
            type: "object",
            properties: {
              ename: {
                type: "string",
                description: "Error name (e.g., 'ValueError', 'TypeError')",
              },
              evalue: {
                type: "string",
                description: "Error message",
              },
              traceback: {
                type: "array",
                items: { type: "string" },
                description: "Traceback lines",
              },
            },
            required: ["ename", "evalue", "traceback"],
          },
        },
      },
    ];
  }

  private async queryAIWithTools(
    code: string,
    context: string,
    execContext: ExecutionContext,
  ): Promise<boolean> {
    const systemPrompt =
      `You are an IPython interpreter. Execute the Python code provided using the available tools.

Rules:
- Act exactly like IPython/Jupyter
- For expressions that return values, use execute_result
- For print statements, use stdout
- For imports, typically no output unless there are errors
- For matplotlib plots, use display with appropriate image data
- Handle variables and state as if this were a real Python session
- If there's an error, use the error tool with proper traceback
- Use stdout for any printed output
- Use stderr for warnings
- Be accurate to real Python behavior

Previous conversation context:
${context}

Execute this Python code:`;

    const messages: OpenAIMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: code },
    ];

    try {
      let maxIterations = 5; // Prevent infinite loops
      let iteration = 0;

      while (iteration < maxIterations) {
        iteration++;

        const response = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${this.config.apiKey}`,
            },
            body: JSON.stringify({
              model: this.config.model,
              messages,
              tools: this.getIPythonTools(),
              tool_choice: "auto",
              temperature: 0.1,
              max_tokens: 1000,
            }),
          },
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({
            error: "Unknown API error",
          }));
          throw new Error(
            `OpenAI API error: ${response.status} - ${
              errorData.error?.message || "Unknown error"
            }`,
          );
        }

        const data = await response.json();
        const message = data.choices?.[0]?.message;

        if (!message) {
          throw new Error("No response from AI");
        }

        // Add assistant message to conversation
        messages.push({
          role: "assistant",
          content: message.content,
          tool_calls: message.tool_calls,
        });

        // Process tool calls if any
        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const toolCall of message.tool_calls) {
            const result = await this.handleToolCall(toolCall, execContext);

            // Add tool result to conversation
            messages.push({
              role: "tool",
              content: result,
              tool_call_id: toolCall.id,
            });
          }

          // Continue conversation to see if AI wants to make more tool calls
          continue;
        }

        // No more tool calls, we're done
        break;
      }

      return true;
    } catch (err) {
      this.logger.error("OpenAI API error", err);
      execContext.error(
        "AIPythonError",
        err instanceof Error ? err.message : "AI API error",
        [
          "Error communicating with AI API",
          err instanceof Error ? err.message : String(err),
        ],
      );
      return false;
    }
  }

  private async handleToolCall(
    toolCall: OpenAIToolCall,
    context: ExecutionContext,
  ): Promise<string> {
    const { name, arguments: argsStr } = toolCall.function;

    try {
      const args = JSON.parse(argsStr);

      switch (name) {
        case "stdout":
          context.stdout(args.text);
          return "stdout output written";

        case "stderr":
          context.stderr(args.text);
          return "stderr output written";

        case "execute_result":
          context.result(args.data, args.metadata);
          return "execute result displayed";

        case "display":
          context.display(args.data, args.metadata);
          return "display data shown";

        case "error":
          context.error(args.ename, args.evalue, args.traceback);
          return "error reported";

        default:
          this.logger.warn(`Unknown tool call: ${name}`);
          return `Unknown tool: ${name}`;
      }
    } catch (err) {
      this.logger.error(`Error handling tool call ${name}:`, err);
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private trimConversationHistory() {
    if (this.conversationHistory.length > this.config.maxHistoryLength * 2) {
      // Remove oldest entries, keeping pairs of code/output together
      this.conversationHistory = this.conversationHistory.slice(
        -this.config.maxHistoryLength,
      );
    }
  }
}

// Main execution
async function main() {
  const agent = new AIPythonAgent();

  try {
    await agent.start();

    console.log("🧠 AIPython Agent Started!");
    console.log("💡 This agent simulates Python execution using AI with tools");
    console.log(
      "🐍 Try executing Python code - the AI will use real output methods!",
    );

    await agent.keepAlive();
  } catch (error) {
    console.error("❌ Failed to start AIPython agent:", error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}

// AIPython Runtime Agent - AI-powered Python execution simulation
//
// This agent uses AI to simulate IPython execution by providing the AI with
// tools that are directly connected to the execution context output methods.

import OpenAI from "@openai/openai";
import { createLogger, createRuntimeConfig, RuntimeAgent } from "@runt/lib";
import type { ExecutionContext, ExecutionResult } from "@runt/lib";

interface AIPythonConfig {
  /** AI model to use for Python simulation */
  model: string;
  /** API key for the AI service */
  apiKey: string;
  /** OpenAI base URL (optional) */
  baseURL?: string;
  /** OpenAI organization (optional) */
  organization?: string;
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

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export class AIPythonAgent {
  private agent: RuntimeAgent;
  private config: AIPythonConfig;
  private logger = createLogger("aipython-agent");
  private conversationHistory: ConversationEntry[] = [];
  private openaiClient: OpenAI;

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
      baseURL: aiConfig.baseURL || Deno.env.get("OPENAI_BASE_URL"),
      organization: aiConfig.organization ||
        Deno.env.get("OPENAI_ORGANIZATION"),
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

    // Initialize OpenAI client
    this.openaiClient = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      organization: this.config.organization,
    });

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

  keepAlive() {
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
    let inputCount = 0;

    for (const entry of recentHistory) {
      if (entry.type === "code") {
        inputCount++;
        contextParts.push(`In [${inputCount}]: ${entry.content}`);
      } else if (entry.type === "output" && this.config.includeOutputs) {
        contextParts.push(`Out[${inputCount}]: ${entry.content}`);
      }
    }

    return contextParts.join("\n\n");
  }

  private getIPythonTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
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
                  "text/plain": {
                    type: "string",
                    description: "Plain text output (max 2000 chars)",
                  },
                  "text/html": {
                    type: "string",
                    description: "HTML output (max 2000 chars)",
                  },
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
                  "text/plain": {
                    type: "string",
                    description: "Plain text output (max 2000 chars)",
                  },
                  "text/html": {
                    type: "string",
                    description: "HTML output (max 2000 chars)",
                  },
                  "text/markdown": {
                    type: "string",
                    description: "Markdown output (max 2000 chars)",
                  },
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

IMPORTANT JSON FORMATTING:
- Keep tool call arguments concise and well-formatted
- For large outputs (like matrices, long lists), truncate with "..." and indicate size
- Always properly escape quotes and newlines in JSON strings
- Use \\n for newlines, \\" for quotes within strings
- For very long output, use multiple stdout calls instead of one huge string
- Example: Instead of outputting 1000 lines, output first few lines + summary

Previous conversation context:
${context}

Execute this Python code:`;

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: code },
    ];

    try {
      const maxIterations = 5; // Prevent infinite loops
      let iteration = 0;
      const outputCapture: string[] = [];

      while (iteration < maxIterations) {
        iteration++;

        const response = await this.openaiClient.chat.completions.create({
          model: this.config.model,
          messages,
          tools: this.getIPythonTools(),
          tool_choice: "auto",
          temperature: 0.1,
          max_tokens: 2000,
        });

        const message = response.choices?.[0]?.message;

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
            const result = this.handleToolCall(
              toolCall,
              execContext,
              outputCapture,
            );

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

      // Add captured outputs to conversation history
      if (outputCapture.length > 0) {
        this.conversationHistory.push({
          type: "output",
          content: outputCapture.join("\n"),
          timestamp: new Date(),
        });
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

  private handleToolCall(
    toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall,
    context: ExecutionContext,
    outputCapture?: string[],
  ): string {
    const { name, arguments: argsStr } = toolCall.function;

    try {
      // Handle malformed JSON by attempting to fix common issues
      let args;
      try {
        args = JSON.parse(argsStr);
      } catch (parseError) {
        // Try to fix common JSON issues
        const fixedArgsStr = this.fixMalformedJSON(argsStr);
        try {
          args = JSON.parse(fixedArgsStr);
          this.logger.warn(`Fixed malformed JSON for tool call ${name}`);
        } catch (_secondParseError) {
          this.logger.error(`Failed to parse JSON for tool call ${name}:`, {
            original: argsStr.substring(0, 200) + "...",
            parseError: parseError instanceof Error
              ? parseError.message
              : String(parseError),
          });

          // Fallback: try to extract basic text content
          const fallbackArgs = this.extractFallbackArgs(name, argsStr);
          if (fallbackArgs) {
            args = fallbackArgs;
          } else {
            throw parseError;
          }
        }
      }

      switch (name) {
        case "stdout": {
          const stdoutText = args.text || String(args);
          // Truncate very long output
          const truncatedStdout = stdoutText.length > 5000
            ? stdoutText.substring(0, 5000) + "\n[Output truncated...]"
            : stdoutText;
          context.stdout(truncatedStdout);
          outputCapture?.push(truncatedStdout);
          return "stdout output written";
        }

        case "stderr": {
          const stderrText = args.text || String(args);
          // Truncate very long output
          const truncatedStderr = stderrText.length > 5000
            ? stderrText.substring(0, 5000) + "\n[Output truncated...]"
            : stderrText;
          context.stderr(truncatedStderr);
          outputCapture?.push(`stderr: ${truncatedStderr}`);
          return "stderr output written";
        }

        case "execute_result": {
          const resultData = args.data || { "text/plain": String(args) };
          context.result(resultData, args.metadata);
          const resultText = resultData["text/plain"] ||
            JSON.stringify(resultData);
          outputCapture?.push(resultText);
          return "execute result displayed";
        }

        case "display": {
          const displayData = args.data || { "text/plain": String(args) };
          context.display(displayData, args.metadata);
          const displayText = displayData["text/plain"] ||
            "[Rich display content]";
          outputCapture?.push(displayText);
          return "display data shown";
        }

        case "error": {
          const ename = args.ename || "PythonError";
          const evalue = args.evalue || "Error during execution";
          const traceback = args.traceback || [evalue];
          context.error(ename, evalue, traceback);
          outputCapture?.push(`${ename}: ${evalue}`);
          return "error reported";
        }

        default:
          this.logger.warn(`Unknown tool call: ${name}`);
          return `Unknown tool: ${name}`;
      }
    } catch (err) {
      this.logger.error(`Error handling tool call ${name}:`, err);

      // Final fallback: try to output something useful
      switch (name) {
        case "stdout":
        case "stderr":
          context.stdout(
            `[Error parsing tool call: ${
              err instanceof Error ? err.message : String(err)
            }]`,
          );
          break;
        case "execute_result":
        case "display":
          context.result({
            "text/plain": `[Error parsing tool call: ${
              err instanceof Error ? err.message : String(err)
            }]`,
          });
          break;
        case "error":
          context.error(
            "ToolCallError",
            err instanceof Error ? err.message : String(err),
            ["Tool call parsing failed"],
          );
          break;
      }

      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private fixMalformedJSON(jsonStr: string): string {
    // Common fixes for malformed JSON
    let fixed = jsonStr;

    // Fix unterminated strings by finding last quote and ensuring it's closed
    const lastQuoteIndex = fixed.lastIndexOf('"');
    if (lastQuoteIndex !== -1) {
      const afterLastQuote = fixed.substring(lastQuoteIndex + 1);
      if (
        !afterLastQuote.includes('"') && !afterLastQuote.trim().endsWith("}")
      ) {
        // Likely unterminated string, add closing quote
        fixed = fixed.substring(0, lastQuoteIndex + 1) + '"' + afterLastQuote;
      }
    }

    // Ensure JSON object is properly closed
    const openBraces = (fixed.match(/\{/g) || []).length;
    const closeBraces = (fixed.match(/\}/g) || []).length;
    if (openBraces > closeBraces) {
      fixed += "}";
    }

    // Fix common escape sequence issues
    fixed = fixed.replace(/\\n/g, "\\n");
    fixed = fixed.replace(/\\t/g, "\\t");
    fixed = fixed.replace(/\\r/g, "\\r");

    return fixed;
  }

  private extractFallbackArgs(
    toolName: string,
    malformedJson: string,
  ): unknown {
    // Try to extract basic content from malformed JSON
    switch (toolName) {
      case "stdout":
      case "stderr": {
        // Try to extract text content
        const textMatch = malformedJson.match(/"text":\s*"([^"]*)/);
        if (textMatch) {
          return { text: textMatch[1] };
        }
        break;
      }

      case "execute_result":
      case "display": {
        // Try to extract text/plain content
        const plainMatch = malformedJson.match(/"text\/plain":\s*"([^"]*)/);
        if (plainMatch) {
          return { data: { "text/plain": plainMatch[1] } };
        }
        break;
      }
    }

    return null;
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

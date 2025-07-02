import OpenAI from "@openai/openai";
import { createLogger, type ExecutionContext } from "@runt/lib";

// Define message types inline to avoid import issues
type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

interface OpenAIConfig {
  apiKey?: string;
  baseURL?: string;
  organization?: string;
}

interface ToolParameter {
  type: string;
  enum?: string[];
  description?: string;
  default?: string;
}

interface NotebookTool {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, ToolParameter>;
    required: string[];
  };
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolCallOutput {
  tool_call_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  status: "success" | "error";
  timestamp: string;
  result?: string;
}

interface OutputData {
  type: "display_data" | "execute_result" | "error";
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface AgenticOptions {
  maxIterations?: number;
  onIteration?: (
    iteration: number,
    messages: ChatMessage[],
  ) => Promise<boolean>;
  interruptSignal?: AbortSignal;
}

interface AnodeCellMetadata {
  role?: "assistant" | "user" | "function_call" | "tool";
  ai_provider?: string;
  ai_model?: string;
  iteration?: number;
  tool_call?: boolean;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  tool_error?: boolean;
  tool_call_id?: string;
}

// Define available notebook tools
const NOTEBOOK_TOOLS: NotebookTool[] = [
  {
    name: "create_cell",
    description:
      "Create a new cell in the notebook at a specified position. Use this when you want to add new code, markdown, or other content to help the user.",
    parameters: {
      type: "object",
      properties: {
        cellType: {
          type: "string",
          enum: ["code", "markdown", "ai", "sql"],
          description: "The type of cell to create",
        },
        content: {
          type: "string",
          description: "The content/source code for the cell",
        },
        position: {
          type: "string",
          enum: ["after_current", "before_current", "at_end"],
          description:
            'Where to place the new cell. Use "after_current" (default) to place right after the AI cell, "before_current" to place before it, or "at_end" only when specifically requested',
          default: "after_current",
        },
      },
      required: ["cellType", "content"],
    },
  },
  {
    name: "modify_cell",
    description:
      "Modify the content of an existing cell in the notebook. Use this to fix bugs, improve code, or update content based on user feedback. Use the actual cell ID from the context (shown as 'ID: cell-xxx'), not position numbers.",
    parameters: {
      type: "object",
      properties: {
        cellId: {
          type: "string",
          description:
            "The actual cell ID from the context (e.g., 'cell-1234567890-abc'), not a position number",
        },
        content: {
          type: "string",
          description: "The new content/source code for the cell",
        },
      },
      required: ["cellId", "content"],
    },
  },
  {
    name: "execute_cell",
    description:
      "Execute a specific cell in the notebook. Use this to run code after creating or modifying it, or to re-run existing cells. Use the actual cell ID from the context (shown as 'ID: cell-xxx'), not position numbers.",
    parameters: {
      type: "object",
      properties: {
        cellId: {
          type: "string",
          description:
            "The actual cell ID from the context (e.g., 'cell-1234567890-abc'), not a position number",
        },
      },
      required: ["cellId"],
    },
  },
];

export class RuntOpenAIClient {
  private client: OpenAI | null = null;
  private isConfigured = false;
  private logger = createLogger("openai-client");

  constructor(config?: OpenAIConfig) {
    // Don't configure immediately to avoid early initialization logs
    if (config) {
      this.configure(config);
    }
  }

  configure(config?: OpenAIConfig) {
    const apiKey = config?.apiKey || Deno.env.get("OPENAI_API_KEY");

    if (!apiKey) {
      // Don't log warning at startup - only when actually trying to use OpenAI
      this.isConfigured = false;
      return;
    }

    try {
      this.client = new OpenAI({
        apiKey,
        baseURL: config?.baseURL,
        organization: config?.organization,
      });
      this.isConfigured = true;
      this.logger.info("OpenAI client configured successfully");
    } catch (error) {
      this.logger.error("Failed to configure OpenAI client", error);
      this.isConfigured = false;
    }
  }

  isReady(): boolean {
    // Try to configure if not already configured and not already failed
    if (!this.isConfigured && this.client === null) {
      this.configure();
    }
    return this.isConfigured && this.client !== null;
  }

  async generateAgenticResponse(
    messages: ChatMessage[],
    context: ExecutionContext,
    options: {
      model?: string;
      provider?: string;
      maxTokens?: number;
      temperature?: number;
      enableTools?: boolean;
      currentCellId?: string;
      onToolCall?: (toolCall: ToolCall) => Promise<string>;
    } & AgenticOptions = {},
  ): Promise<void> {
    const {
      model = "gpt-4o-mini",
      maxTokens = 2000,
      temperature = 0.7,
      enableTools = true,
      currentCellId: _currentCellId,
      onToolCall,
      maxIterations = 10,
      onIteration,
      interruptSignal,
    } = options;

    if (!this.isReady()) {
      const configOutputs = this.createConfigHelpOutput();
      for (const output of configOutputs) {
        if (output.type === "display_data") {
          context.display(output.data, output.metadata || {});
        }
      }
      return;
    }

    const conversationMessages: ChatMessage[] = messages;

    let iteration = 0;

    try {
      while (iteration < maxIterations) {
        // Check for interruption
        if (interruptSignal?.aborted) {
          this.logger.info("Agentic conversation interrupted");
          break;
        }

        // Call iteration callback if provided
        if (onIteration) {
          const shouldContinue = await onIteration(
            iteration,
            conversationMessages,
          );
          if (!shouldContinue) {
            this.logger.info(
              "Agentic conversation stopped by iteration callback",
            );
            break;
          }
        }

        this.logger.info(`Agentic iteration ${iteration + 1}/${maxIterations}`);

        // Prepare tools if enabled
        const tools = enableTools
          ? NOTEBOOK_TOOLS.map((tool) => ({
            type: "function" as const,
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          }))
          : undefined;

        const response = await this.client!.chat.completions.create({
          model,
          messages: conversationMessages,
          max_tokens: maxTokens,
          temperature,
          stream: false,
          ...(tools ? { tools } : {}),
          ...(enableTools && tools ? { tool_choice: "auto" as const } : {}),
        });

        const message = response.choices[0]?.message;
        const content = message?.content;
        const toolCalls = message?.tool_calls;

        // Add assistant message to conversation (with tool_calls if present)
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: content || "",
          ...(toolCalls && toolCalls.length > 0
            ? { tool_calls: toolCalls }
            : {}),
        };

        conversationMessages.push(assistantMessage);

        // Emit assistant response with role metadata
        if (content) {
          const metadata: AnodeCellMetadata = {
            role: "assistant",
            ai_provider: "openai",
            ai_model: model,
            iteration: iteration + 1,
          };
          context.display({
            "text/markdown": content,
            "text/plain": content,
          }, {
            anode: metadata,
          });
        }

        // Handle tool calls if present
        if (toolCalls && toolCalls.length > 0 && onToolCall) {
          this.logger.info(
            `Processing ${toolCalls.length} tool calls in iteration ${
              iteration + 1
            }`,
          );

          let _hasToolErrors = false;
          const toolResults: string[] = [];

          for (const toolCall of toolCalls) {
            if (toolCall.type === "function") {
              let args: Record<string, unknown> = {};
              let parseError: Error | null = null;

              try {
                args = JSON.parse(toolCall.function.arguments);
              } catch (error) {
                parseError = error instanceof Error
                  ? error
                  : new Error(String(error));
                this.logger.error(
                  `Error parsing tool arguments for ${toolCall.function.name}`,
                  error,
                );
              }

              if (parseError) {
                _hasToolErrors = true;
                const errorMessage =
                  `Error parsing arguments: ${parseError.message}`;
                toolResults.push(
                  `Tool ${toolCall.function.name} failed: ${errorMessage}`,
                );

                const toolCallData: ToolCallOutput = {
                  tool_call_id: toolCall.id,
                  tool_name: toolCall.function.name,
                  arguments: { raw_arguments: toolCall.function.arguments },
                  status: "error",
                  timestamp: new Date().toISOString(),
                  result: errorMessage,
                };

                const errorMetadata: AnodeCellMetadata = {
                  role: "function_call",
                  tool_call: true,
                  tool_name: toolCall.function.name,
                  tool_error: true,
                  iteration: iteration + 1,
                };

                const errorOutput: OutputData = {
                  type: "display_data",
                  data: {
                    "application/vnd.anode.aitool+json": toolCallData,
                    "text/markdown":
                      `❌ **Tool failed**: \`${toolCall.function.name}\`\n\nError parsing arguments: ${parseError.message}`,
                    "text/plain":
                      `Tool failed: ${toolCall.function.name} - Error parsing arguments: ${parseError.message}`,
                  },
                  metadata: {
                    anode: errorMetadata,
                  },
                };

                // Emit immediately via execution context
                context.display(errorOutput.data, errorOutput.metadata);

                // Add tool error to conversation
                conversationMessages.push({
                  role: "tool",
                  content: `Error: ${errorMessage}`,
                  tool_call_id: toolCall.id,
                });
                continue;
              }

              try {
                this.logger.info(`Calling tool: ${toolCall.function.name}`, {
                  args,
                  iteration: iteration + 1,
                });

                // Execute the tool call and get result
                const toolResult = await onToolCall({
                  id: toolCall.id,
                  name: toolCall.function.name,
                  arguments: args,
                });

                toolResults.push(
                  `Tool ${toolCall.function.name} executed successfully${
                    toolResult ? `: ${toolResult}` : ""
                  }`,
                );

                // Add confirmation output with custom media type
                const toolCallData: ToolCallOutput = {
                  tool_call_id: toolCall.id,
                  tool_name: toolCall.function.name,
                  arguments: args,
                  status: "success",
                  timestamp: new Date().toISOString(),
                  result: toolResult,
                };

                const successMetadata: AnodeCellMetadata = {
                  role: "function_call",
                  tool_call: true,
                  tool_name: toolCall.function.name,
                  tool_args: args,
                  iteration: iteration + 1,
                };

                const successOutput: OutputData = {
                  type: "display_data",
                  data: {
                    "application/vnd.anode.aitool+json": toolCallData,
                    "text/markdown":
                      `🔧 **Tool executed**: \`${toolCall.function.name}\`\n\n${
                        this.formatToolCall(toolCall.function.name, args)
                      }${toolResult ? `\n\n**Result**: ${toolResult}` : ""}`,
                    "text/plain": `Tool executed: ${toolCall.function.name}${
                      toolResult ? ` - ${toolResult}` : ""
                    }`,
                  },
                  metadata: {
                    anode: successMetadata,
                  },
                };

                // Emit immediately via execution context
                context.display(successOutput.data, successOutput.metadata);

                // Add tool result to conversation
                conversationMessages.push({
                  role: "tool",
                  content: toolResult || "Success",
                  tool_call_id: toolCall.id,
                });

                // Emit tool result with role metadata
                const toolResultMetadata: AnodeCellMetadata = {
                  role: "tool",
                  tool_call_id: toolCall.id,
                  tool_name: toolCall.function.name,
                  iteration: iteration + 1,
                };
                context.display({
                  "application/vnd.anode.aitool.result+json": {
                    tool_call_id: toolCall.id,
                    result: toolResult,
                    status: "success",
                  },
                }, {
                  anode: toolResultMetadata,
                });
              } catch (error) {
                _hasToolErrors = true;
                const errorMessage = error instanceof Error
                  ? error.message
                  : String(error);
                toolResults.push(
                  `Tool ${toolCall.function.name} failed: ${errorMessage}`,
                );

                this.logger.error(
                  `Error executing tool ${toolCall.function.name}`,
                  error,
                );

                const errorToolCallData: ToolCallOutput = {
                  tool_call_id: toolCall.id,
                  tool_name: toolCall.function.name,
                  arguments: args,
                  status: "error",
                  timestamp: new Date().toISOString(),
                  result: errorMessage,
                };

                const toolErrorMetadata: AnodeCellMetadata = {
                  role: "function_call",
                  tool_call: true,
                  tool_name: toolCall.function.name,
                  tool_error: true,
                  iteration: iteration + 1,
                };

                const errorOutput: OutputData = {
                  type: "display_data",
                  data: {
                    "application/vnd.anode.aitool+json": errorToolCallData,
                    "text/markdown":
                      `❌ **Tool failed**: \`${toolCall.function.name}\`\n\nError: ${errorMessage}`,
                    "text/plain":
                      `Tool failed: ${toolCall.function.name} - ${errorMessage}`,
                  },
                  metadata: {
                    anode: toolErrorMetadata,
                  },
                };

                // Emit immediately via execution context
                context.display(errorOutput.data, errorOutput.metadata);

                // Add tool error to conversation
                conversationMessages.push({
                  role: "tool",
                  content: `Error: ${errorMessage}`,
                  tool_call_id: toolCall.id,
                });
              }
            }
          }

          // Content was already emitted above with role metadata

          // Continue to next iteration to let AI respond to tool results
          iteration++;
          continue;
        }

        // Content was already emitted above with role metadata

        // No more tool calls, conversation is complete
        this.logger.info(
          `Agentic conversation completed after ${iteration + 1} iterations`,
        );
        break;
      }

      if (iteration >= maxIterations) {
        this.logger.warn(
          `Agentic conversation reached max iterations (${maxIterations})`,
        );
        context.display({
          "text/markdown":
            "⚠️ **Reached maximum iterations** - The AI assistant has reached the maximum number of conversation iterations. The conversation may be incomplete.",
          "text/plain":
            "Reached maximum iterations - conversation may be incomplete",
        }, {
          "anode/ai_response": true,
          "anode/ai_provider": "openai",
          "anode/ai_model": model,
          "anode/max_iterations_reached": true,
        });
      }
    } catch (error: unknown) {
      this.logger.error("OpenAI API error in agentic conversation", error);

      let errorMessage = "Unknown error occurred";
      if (error && typeof error === "object") {
        const err = error as { status?: number; message?: string };
        if (err.status === 401) {
          errorMessage =
            "Invalid API key. Please check your OPENAI_API_KEY environment variable.";
        } else if (err.status === 429) {
          errorMessage = "Rate limit exceeded. Please try again later.";
        } else if (err.status === 500) {
          errorMessage = "OpenAI server error. Please try again later.";
        } else if (err.message) {
          errorMessage = err.message;
        }
      }

      const errorOutputs = this.createErrorOutput(
        `OpenAI API Error: ${errorMessage}`,
      );
      for (const output of errorOutputs) {
        if (output.type === "display_data") {
          context.display(output.data, output.metadata || {});
        } else if (output.type === "error" && output.data) {
          const errorData = output.data as {
            ename?: string;
            evalue?: string;
            traceback?: string[];
          };
          context.error(
            errorData.ename || "OpenAIError",
            errorData.evalue || "Unknown error",
            errorData.traceback || ["Unknown error"],
          );
        }
      }
    }
  }

  private createErrorOutput(message: string): OutputData[] {
    return [{
      type: "error",
      data: {
        ename: "OpenAIError",
        evalue: message,
        traceback: [message],
      },
    }];
  }

  private createConfigHelpOutput(): OutputData[] {
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

    return [{
      type: "display_data",
      data: {
        "text/markdown": configMessage,
        "text/plain": configMessage.replace(/[#*`]/g, "").replace(/\n+/g, "\n")
          .trim(),
      },
      metadata: {
        "anode/ai_config_help": true,
      },
    }];
  }

  private formatToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): string {
    switch (toolName) {
      case "create_cell": {
        const cellType = String(args.cellType || "code");
        const position = String(args.position || "after_current");
        const content = String(args.content || "");
        return `Created **${cellType}** cell at position **${position}**\n\n` +
          `Content preview:\n\`\`\`${
            cellType === "code" ? "python" : cellType
          }\n${content.slice(0, 200)}${
            content.length > 200 ? "..." : ""
          }\n\`\`\``;
      }
      case "modify_cell": {
        const cellId = String(args.cellId || "");
        const content = String(args.content || "");
        return `Modified cell **${cellId}**\n\n` +
          `New content preview:\n\`\`\`python\n${content.slice(0, 200)}${
            content.length > 200 ? "..." : ""
          }\n\`\`\``;
      }
      case "execute_cell": {
        const cellId = String(args.cellId || "");
        return `Executed cell **${cellId}**`;
      }
      default: {
        return `Arguments: ${JSON.stringify(args, null, 2)}`;
      }
    }
  }
}

// Export class for testing
export { RuntOpenAIClient as OpenAIClient };

import OpenAI from "@openai/openai";
import {
  type AiModel,
  createLogger,
  type ExecutionContext,
  type ModelCapability,
} from "@runt/lib";
import { AI_TOOL_CALL_MIME_TYPE, AI_TOOL_RESULT_MIME_TYPE } from "@runt/schema";

import { NOTEBOOK_TOOLS } from "./tool-registry.ts";

// Define message types inline to avoid import issues
type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

interface OpenAIConfig {
  apiKey?: string;
  baseURL?: string;
  organization?: string;
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
    const baseURL = config?.baseURL || Deno.env.get("OPENAI_BASE_URL");

    if (!apiKey) {
      // Don't log warning at startup - only when actually trying to use OpenAI
      this.isConfigured = false;
      return;
    }

    try {
      this.client = new OpenAI({
        apiKey,
        baseURL: baseURL,
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

  /**
   * Get hardcoded OpenAI model capabilities
   * (OpenAI doesn't expose capabilities via API)
   */
  private getOpenAIModelCapabilities(modelName: string): ModelCapability[] {
    const capabilities: ModelCapability[] = ["completion"];

    // All current OpenAI models support tools
    capabilities.push("tools");

    // Vision models
    if (
      modelName.includes("gpt-4o") ||
      modelName.includes("gpt-4.1") ||
      modelName.includes("o3") ||
      modelName.includes("o4")
    ) {
      capabilities.push("vision");
    }

    // Reasoning models
    if (
      modelName.includes("o1") ||
      modelName.includes("o3") ||
      modelName.includes("o4")
    ) {
      capabilities.push("thinking");
    }

    return capabilities;
  }

  /**
   * OpenAI Reasoning Models Compatibility Guide
   *
   * Reasoning models (o1, o3, o4 series) have specific parameter restrictions:
   *
   * 1. **Token Parameters**: Use max_completion_tokens instead of max_tokens
   * 2. **Temperature**: Fixed at 1 (no custom values supported)
   * 3. **System Messages**:
   *    - o1 family: Not supported (convert to user messages)
   *    - o3/o4 family: Converted to developer messages by API
   * 4. **Other Fixed Parameters**: top_p=1, presence_penalty=0, frequency_penalty=0
   * 5. **Reasoning Effort**: Some models support low/medium/high effort levels
   *
   * Models affected: o1-preview, o1-mini, o1-pro, o3, o3-mini, o3-pro, o4-mini, etc.
   */

  /**
   * Check if model is a reasoning model (starts with 'o')
   */
  private isReasoningModel(modelName: string): boolean {
    return modelName.startsWith("o1") ||
      modelName.startsWith("o3") ||
      modelName.startsWith("o4");
  }

  /**
   * Check if model uses max_completion_tokens instead of max_tokens
   */
  private usesMaxCompletionTokens(modelName: string): boolean {
    return modelName.startsWith("o1") ||
      modelName.startsWith("o3") ||
      modelName.startsWith("o4");
  }

  /**
   * Check if model supports system messages
   */
  private supportsSystemMessages(modelName: string): boolean {
    // o1 family models don't support system messages at all
    // o3/o4 models convert system messages to developer messages (handled by API)
    return !modelName.startsWith("o1");
  }

  /**
   * Filter messages based on model capabilities
   */
  private filterMessagesForModel(
    messages: ChatMessage[],
    modelName: string,
  ): ChatMessage[] {
    if (this.supportsSystemMessages(modelName)) {
      return messages;
    }

    // For models that don't support system messages, convert system message to user message
    return messages.map((msg) => {
      if (msg.role === "system") {
        return {
          role: "user" as const,
          content: `System instructions: ${msg.content}`,
        };
      }
      return msg;
    });
  }

  /**
   * Check if model supports custom temperature values
   */
  private supportsCustomTemperature(modelName: string): boolean {
    // All reasoning models (o1, o3, o4) have temperature fixed at 1
    return !(modelName.startsWith("o1") ||
      modelName.startsWith("o3") ||
      modelName.startsWith("o4"));
  }

  /**
   * Get available OpenAI models (hardcoded for now)
   */
  private getOpenAIModels(): Array<{
    name: string;
    displayName: string;
    contextLength: number;
    deprecated?: boolean;
  }> {
    return [
      // Latest flagship models
      {
        name: "o4-mini",
        displayName: "o4-mini",
        contextLength: 200000,
      },
      {
        name: "o3",
        displayName: "o3",
        contextLength: 200000,
      },
      {
        name: "gpt-4.1",
        displayName: "GPT-4.1",
        contextLength: 1047552,
      },
      // Current stable models
      {
        name: "gpt-4o",
        displayName: "GPT-4o",
        contextLength: 128000,
      },
      {
        name: "gpt-4o-mini",
        displayName: "GPT-4o Mini",
        contextLength: 128000,
      },
      {
        name: "o1",
        displayName: "o1",
        contextLength: 128000,
      },
      {
        name: "o1-mini",
        displayName: "o1 Mini",
        contextLength: 128000,
      },
    ];
  }

  /**
   * Discover available AI models with their capabilities
   */
  discoverAiModels(): Promise<AiModel[]> {
    if (!this.isReady()) {
      this.logger.warn("OpenAI client not ready, returning empty models list");
      return Promise.resolve([]);
    }

    try {
      const models = this.getOpenAIModels();
      const aiModels: AiModel[] = [];

      for (const model of models) {
        const capabilities = this.getOpenAIModelCapabilities(model.name);

        aiModels.push({
          name: model.name,
          displayName: model.displayName,
          provider: "openai",
          capabilities,
        });
      }

      return Promise.resolve(aiModels);
    } catch (error) {
      this.logger.error("Failed to discover OpenAI models", error);
      return Promise.resolve([]);
    }
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

        // Filter messages based on model capabilities
        const filteredMessages = this.filterMessagesForModel(
          conversationMessages,
          model,
        );

        // Prepare request parameters with model-specific compatibility
        const baseParams = {
          model,
          messages: filteredMessages,
          ...(this.supportsCustomTemperature(model) ? { temperature } : {}),
          stream: true,
          ...(tools ? { tools } : {}),
          ...(enableTools && tools ? { tool_choice: "auto" as const } : {}),
        };

        // Use appropriate token limit parameter based on model
        const requestParams = this.usesMaxCompletionTokens(model)
          ? { ...baseParams, max_completion_tokens: maxTokens }
          : { ...baseParams, max_tokens: maxTokens };

        const response = await this.client!.chat.completions.create(
          requestParams,
        );

        let content = "";
        const toolCalls: Array<{
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        }> = [];
        let markdownOutputId: string | null = null;

        // Stream the response
        for await (
          const chunk of response as AsyncIterable<
            OpenAI.Chat.Completions.ChatCompletionChunk
          >
        ) {
          const delta = chunk.choices[0]?.delta;

          if (delta?.content) {
            // Handle content streaming
            if (!markdownOutputId) {
              // Start new markdown output
              const metadata: AnodeCellMetadata = {
                role: "assistant",
                ai_provider: "openai",
                ai_model: model,
                iteration: iteration + 1,
              };
              markdownOutputId = context.markdown(delta.content, {
                anode: metadata,
              });
            } else {
              // Append to existing markdown output
              context.appendMarkdown(markdownOutputId, delta.content);
            }
            content += delta.content;
          }

          if (delta?.tool_calls) {
            // Handle tool calls
            for (const toolCallDelta of delta.tool_calls) {
              const index = toolCallDelta.index ?? 0;

              // Initialize tool call if needed
              if (!toolCalls[index]) {
                toolCalls[index] = {
                  id: "",
                  type: "function",
                  function: { name: "", arguments: "" },
                };
              }

              if (toolCallDelta.id) {
                toolCalls[index].id = toolCallDelta.id;
              }

              if (toolCallDelta.function?.name) {
                toolCalls[index].function.name = toolCallDelta.function.name;
              }

              if (toolCallDelta.function?.arguments) {
                toolCalls[index].function.arguments +=
                  toolCallDelta.function.arguments;
              }
            }
          }
        }

        // Add assistant message to conversation (with tool_calls if present)
        const assistantMessage: ChatMessage = {
          role: "assistant",
          content: content || "",
          ...(toolCalls && toolCalls.length > 0
            ? { tool_calls: toolCalls }
            : {}),
        };

        conversationMessages.push(assistantMessage);

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
                    [AI_TOOL_CALL_MIME_TYPE]: toolCallData,
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
                    [AI_TOOL_CALL_MIME_TYPE]: toolCallData,
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
                  [AI_TOOL_RESULT_MIME_TYPE]: {
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
                    [AI_TOOL_CALL_MIME_TYPE]: errorToolCallData,
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

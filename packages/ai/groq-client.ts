import Groq from "npm:groq-sdk";
import {
  type AiModel,
  createLogger,
  type ExecutionContext,
  type ModelCapability,
} from "@runt/lib";
import { AI_TOOL_CALL_MIME_TYPE, AI_TOOL_RESULT_MIME_TYPE } from "@runt/schema";

import { getAllTools } from "./tool-registry.ts";
import type { NotebookTool } from "./tool-registry.ts";

// Import OpenAI types for conversion
import type OpenAI from "@openai/openai";

// Define message types similar to OpenAI format but for Groq
type GroqChatMessage = Groq.Chat.Completions.ChatCompletionMessageParam;
type OpenAIChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

interface GroqConfig {
  apiKey?: string;
  baseURL?: string;
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
    messages: OpenAIChatMessage[],
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

// Helper function to convert OpenAI messages to Groq format
function convertOpenAIToGroqMessages(
  messages: OpenAIChatMessage[],
): GroqChatMessage[] {
  return messages.map((message): GroqChatMessage => {
    // Handle basic conversion - most messages should be compatible
    const groqMessage = { ...message } as GroqChatMessage;

    // Handle any specific conversions if needed
    if (message.role === "developer") {
      // Groq doesn't support "developer" role, convert to "system"
      return {
        role: "system",
        content: message.content || "",
      };
    }

    return groqMessage;
  });
}

export class GroqClient {
  private client: Groq | null = null;
  private isConfigured = false;
  private logger = createLogger("groq-client");
  private notebookTools: NotebookTool[];

  constructor(config?: GroqConfig, notebookTools: NotebookTool[] = []) {
    // Don't configure immediately to avoid early initialization logs
    if (config) {
      this.configure(config);
    }
    this.notebookTools = [...notebookTools];
  }

  configure(config?: GroqConfig) {
    const apiKey = config?.apiKey || Deno.env.get("GROQ_API_KEY");
    const baseURL = config?.baseURL;

    if (!apiKey) {
      // Don't log warning at startup - only when actually trying to use Groq
      this.isConfigured = false;
      return;
    }

    try {
      this.client = new Groq({
        apiKey,
        baseURL: baseURL,
      });
      this.isConfigured = true;
      this.logger.info("Groq client configured successfully");
    } catch (error) {
      this.logger.error("Failed to configure Groq client", error);
      this.isConfigured = false;
    }
  }

  isReady(): boolean {
    return this.isConfigured && this.client !== null;
  }

  async discoverAiModels(): Promise<AiModel[]> {
    if (!this.isReady()) {
      throw new Error("Groq client not configured");
    }

    // Groq has a set of known models - we'll hardcode these since they're stable
    return [
      {
        provider: "groq",
        name: "llama-3.1-70b-versatile",
        displayName: "Llama 3.1 70B Versatile",
        capabilities: ["completion", "tools", "thinking"],
      },
      {
        provider: "groq",
        name: "llama-3.1-8b-instant",
        displayName: "Llama 3.1 8B Instant",
        capabilities: ["completion", "tools", "thinking"],
      },
      {
        provider: "groq",
        name: "llama3-70b-8192",
        displayName: "Llama 3 70B",
        capabilities: ["completion", "tools", "thinking"],
      },
      {
        provider: "groq",
        name: "llama3-8b-8192",
        displayName: "Llama 3 8B",
        capabilities: ["completion", "tools", "thinking"],
      },
      {
        provider: "groq",
        name: "mixtral-8x7b-32768",
        displayName: "Mixtral 8x7B",
        capabilities: ["completion", "tools"],
      },
      {
        provider: "groq",
        name: "gemma2-9b-it",
        displayName: "Gemma 2 9B",
        capabilities: ["completion", "tools"],
      },
    ];
  }

  async generateAgenticResponse(
    messages: OpenAIChatMessage[],
    context: ExecutionContext,
    options: AgenticOptions & {
      model?: string;
      provider?: string;
      temperature?: number;
      enableTools?: boolean;
      currentCellId?: string;
      onToolCall?: (toolCall: ToolCall) => Promise<string>;
    } = {},
  ): Promise<void> {
    if (!this.isReady()) {
      throw new Error("Groq client not configured");
    }

    const {
      model = "llama-3.1-70b-versatile",
      temperature = 0.7,
      enableTools = false,
      maxIterations = 10,
      currentCellId,
      onToolCall,
      onIteration,
      interruptSignal,
    } = options;

    this.logger.info("Starting Groq agentic response", {
      model,
      messageCount: messages.length,
      enableTools,
      maxIterations,
    });

    let conversationMessages = convertOpenAIToGroqMessages(messages);
    let iteration = 0;

    try {
      while (iteration < maxIterations) {
        if (interruptSignal?.aborted) {
          this.logger.info("Groq conversation interrupted by signal");
          break;
        }

        // Check if we should continue with another iteration
        if (onIteration && iteration > 0) {
          // Convert back to OpenAI format for the callback
          const openaiMessages = conversationMessages.map((msg) => ({
            ...msg,
          })) as OpenAIChatMessage[];
          const shouldContinue = await onIteration(iteration, openaiMessages);
          if (!shouldContinue) {
            this.logger.info("Groq conversation stopped by iteration handler");
            break;
          }
        }

        this.logger.debug(`Groq iteration ${iteration + 1}`, {
          messageCount: conversationMessages.length,
          model,
        });

        // Prepare tools if enabled
        const tools = enableTools ? await this.prepareTools() : undefined;

        // Make the API call
        const completion = await this.client!.chat.completions.create({
          model,
          messages: conversationMessages,
          temperature,
          tools,
          tool_choice: tools ? "auto" : undefined,
          stream: true,
        });

        let responseContent = "";
        let toolCalls: Array<{
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        }> = [];

        // Process streaming response
        for await (const chunk of completion) {
          if (interruptSignal?.aborted) {
            this.logger.info("Groq conversation interrupted during streaming");
            break;
          }

          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          // Handle content streaming
          if (delta.content) {
            responseContent += delta.content;

            // Stream content to the execution context
            context.display({
              "text/markdown": responseContent,
              "text/plain": responseContent,
            }, {
              "anode/ai_provider": "groq",
              "anode/ai_model": model,
              "anode/role": "assistant",
              "anode/streaming": true,
            });
          }

          // Handle tool calls
          if (delta.tool_calls) {
            for (const toolCall of delta.tool_calls) {
              if (toolCall.index !== undefined) {
                if (!toolCalls[toolCall.index]) {
                  toolCalls[toolCall.index] = {
                    id: toolCall.id || "",
                    type: "function",
                    function: { name: "", arguments: "" },
                  };
                }

                if (toolCall.id) {
                  toolCalls[toolCall.index].id = toolCall.id;
                }
                if (toolCall.function?.name) {
                  toolCalls[toolCall.index].function.name =
                    toolCall.function.name;
                }
                if (toolCall.function?.arguments) {
                  toolCalls[toolCall.index].function.arguments +=
                    toolCall.function.arguments;
                }
              }
            }
          }
        }

        // Add assistant message to conversation
        const assistantMessage: GroqChatMessage = {
          role: "assistant",
          content: responseContent || null,
        };

        if (toolCalls.length > 0) {
          assistantMessage.tool_calls = toolCalls;
        }

        conversationMessages.push(assistantMessage);

        // Handle tool calls if present
        if (toolCalls.length > 0 && onToolCall) {
          for (const toolCall of toolCalls) {
            if (interruptSignal?.aborted) break;

            try {
              const parsedArgs = JSON.parse(toolCall.function.arguments);
              const result = await onToolCall({
                id: toolCall.id,
                name: toolCall.function.name,
                arguments: parsedArgs,
              });

              // Add tool result to conversation
              conversationMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: result,
              });
            } catch (error) {
              this.logger.error("Error executing tool call", {
                toolName: toolCall.function.name,
                error: error instanceof Error ? error.message : String(error),
              });

              conversationMessages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: `Error executing tool: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              });
            }
          }
        } else {
          // No tool calls, conversation is complete
          break;
        }

        iteration++;
      }

      this.logger.info("Groq conversation completed", {
        iterations: iteration,
        finalMessageCount: conversationMessages.length,
      });
    } catch (error) {
      this.logger.error("Error in Groq conversation", {
        error: error instanceof Error ? error.message : String(error),
        iteration,
      });

      context.display({
        "text/markdown": `**Error:** ${
          error instanceof Error ? error.message : String(error)
        }`,
        "text/plain": `Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }, {
        "anode/ai_provider": "groq",
        "anode/ai_model": model,
        "anode/role": "assistant",
        "anode/error": true,
      });

      throw error;
    }
  }

  private async prepareTools(): Promise<
    Groq.Chat.Completions.ChatCompletionTool[]
  > {
    let allTools = await getAllTools();

    // Add any notebook-specific tools from constructor
    if (this.notebookTools.length > 0) {
      allTools = [...this.notebookTools, ...allTools];
    }

    return allTools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
}

// Export as both GroqClient and RuntGroqClient for consistency
export { GroqClient as RuntGroqClient };

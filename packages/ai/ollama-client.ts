import { Ollama } from "npm:ollama";
import type { Message, Tool } from "npm:ollama";
import type { AiModel, ModelCapability } from "@runt/lib";
import { createLogger, type ExecutionContext } from "@runt/lib";

import { AI_TOOL_CALL_MIME_TYPE, AI_TOOL_RESULT_MIME_TYPE } from "@runt/schema";

import { NOTEBOOK_TOOLS } from "./tool-registry.ts";
import {
  type AgenticOptions,
  type AnodeCellMetadata,
  createConfigHelpOutput,
  createErrorOutput,
  formatToolCall,
  type OutputData,
  type ToolCall,
  type ToolCallOutput,
} from "./shared-types.ts";

// Define message types compatible with Ollama
type OllamaChatMessage = Message;

interface OllamaConfig {
  host?: string;
  model?: string;
  proxy?: boolean;
  headers?: HeadersInit;
}

interface ModelInfo {
  name: string;
  modified_at: Date;
  size: number;
  digest: string;
  details: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

export class RuntOllamaClient {
  private client: Ollama;
  private isConfigured = false;
  private logger = createLogger("ollama-client");
  private config: OllamaConfig;

  constructor(config?: OllamaConfig) {
    this.config = config || {};
    this.client = new Ollama();
    this.configure(config);
  }

  configure(config?: OllamaConfig) {
    const host = config?.host || this.config.host ||
      Deno.env.get("OLLAMA_HOST") || "http://localhost:11434";
    const headers = config?.headers || this.config.headers;
    const proxy = config?.proxy ?? this.config.proxy ?? false;

    try {
      // Create a new Ollama instance with configuration
      this.client = new Ollama({
        host,
        ...(headers && { headers }),
        proxy,
      });
      this.config = { ...this.config, ...config, host };
      this.isConfigured = true;
      this.logger.info("Ollama client configured successfully", { host });
    } catch (error) {
      this.logger.error("Failed to configure Ollama client", error);
      this.isConfigured = false;
    }
  }

  async isReady(): Promise<boolean> {
    if (!this.isConfigured) {
      this.configure();
    }

    if (!this.isConfigured) {
      return false;
    }

    try {
      // Test connection by listing models
      await this.client.list();
      return true;
    } catch (error) {
      this.logger.error("Ollama server not available", error);
      return false;
    }
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    if (!this.isConfigured) {
      throw new Error("Ollama client not configured");
    }

    try {
      const response = await this.client.list();
      return response.models.map((model) => ({
        name: model.name,
        modified_at: model.modified_at,
        size: model.size,
        digest: model.digest,
        details: {
          family: model.details.family,
          parameter_size: model.details.parameter_size,
          quantization_level: model.details.quantization_level,
        },
      }));
    } catch (error) {
      this.logger.info("Ollama server not available", {
        host: this.config.host,
      });
      throw error;
    }
  }

  async ensureModelExists(modelName: string): Promise<boolean> {
    try {
      const models = await this.getAvailableModels();
      const modelExists = models.some((model) => model.name === modelName);

      if (!modelExists) {
        this.logger.info(
          `Model ${modelName} not found locally, attempting to pull...`,
        );

        // Try to pull the model
        const pullResponse = await this.client.pull({
          model: modelName,
          stream: false,
        });

        if (pullResponse.status === "success") {
          this.logger.info(`Successfully pulled model ${modelName}`);
          return true;
        } else {
          this.logger.error(`Failed to pull model ${modelName}`, pullResponse);
          return false;
        }
      }

      return true;
    } catch (error) {
      this.logger.error(`Error checking/pulling model ${modelName}`, error);
      return false;
    }
  }

  /**
   * Get model capabilities by querying the model info
   */
  async getModelCapabilities(modelName: string): Promise<ModelCapability[]> {
    try {
      const response = await this.client.show({ model: modelName });
      const capabilities = response.capabilities || [];

      // Map Ollama capabilities to our standard capabilities
      const mappedCapabilities: ModelCapability[] = [];

      if (capabilities.includes("completion")) {
        mappedCapabilities.push("completion");
      }
      if (capabilities.includes("tools")) {
        mappedCapabilities.push("tools");
      }
      if (capabilities.includes("vision")) {
        mappedCapabilities.push("vision");
      }
      if (capabilities.includes("thinking")) {
        mappedCapabilities.push("thinking");
      }

      // No additional capabilities to infer for now

      return mappedCapabilities;
    } catch (_error) {
      this.logger.warn(
        `Could not get capabilities for model ${modelName}`,
      );
      return ["completion"]; // Default to basic completion
    }
  }

  /**
   * Discover available AI models with their capabilities
   */
  async discoverAiModels(): Promise<AiModel[]> {
    try {
      const models = await this.getAvailableModels();
      const aiModels: AiModel[] = [];

      for (const model of models) {
        try {
          const capabilities = await this.getModelCapabilities(model.name);

          // Create display name from model name
          const displayName = this.createDisplayName(model.name);

          aiModels.push({
            name: model.name,
            displayName,
            provider: "ollama",
            capabilities,
          });
        } catch (_error) {
          this.logger.warn(
            `Could not get capabilities for model ${model.name}`,
          );
          // Still include the model with basic capabilities
          aiModels.push({
            name: model.name,
            displayName: this.createDisplayName(model.name),
            provider: "ollama",
            capabilities: ["completion"],
          });
        }
      }

      return aiModels;
    } catch (_error) {
      this.logger.info(
        "Ollama models not available - server may not be running",
      );
      return [];
    }
  }

  /**
   * Create human-readable display name from model name
   */
  private createDisplayName(modelName: string): string {
    // Handle common model patterns
    const name = modelName
      .replace(/^llama/, "Llama")
      .replace(/^mistral/, "Mistral")
      .replace(/^codellama/, "CodeLlama")
      .replace(/^qwen/, "Qwen")
      .replace(/^gemma/, "Gemma")
      .replace(/^deepseek-coder/, "DeepSeek Coder")
      .replace(/^phi/, "Phi")
      .replace(/^magistral/, "Magistral");

    // Add parameter size if available in the name
    if (name.includes(":")) {
      const [baseName, variant] = name.split(":");
      if (variant && variant.includes("b")) {
        return `${baseName} (${variant.toUpperCase()})`;
      }
      return `${baseName} ${variant || ""}`;
    }

    return name;
  }

  async generateAgenticResponse(
    messages: OllamaChatMessage[],
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
      model = "llama3.1",
      temperature = 0.7,
      enableTools = true,
      currentCellId: _currentCellId,
      onToolCall,
      maxIterations = 10,
      onIteration,
      interruptSignal,
    } = options;

    const ready = await this.isReady();
    if (!ready) {
      const configOutputs = createConfigHelpOutput("Ollama", [
        "- Start Ollama server: `ollama serve`",
        "- Pull models: `ollama pull llama3.1`",
        "- Check server status: `curl http://localhost:11434/api/tags`",
      ]);
      for (const output of configOutputs) {
        if (output.type === "display_data") {
          context.display(output.data, output.metadata || {});
        }
      }
      return;
    }

    // Ensure model exists
    const modelExists = await this.ensureModelExists(model);
    if (!modelExists) {
      const errorOutputs = createErrorOutput(
        `Model ${model} is not available and could not be downloaded. Please check the model name or try pulling it manually with: ollama pull ${model}`,
        "ollama",
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
            errorData.ename || "OllamaError",
            errorData.evalue || "Unknown error",
            errorData.traceback || ["Unknown error"],
          );
        }
      }
      return;
    }

    const conversationMessages: OllamaChatMessage[] = messages;
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
        const tools: Tool[] | undefined = enableTools
          ? NOTEBOOK_TOOLS.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          }))
          : undefined;

        const chatRequest = {
          model,
          messages: conversationMessages,
          stream: true as const,
          options: {
            temperature,
          },
          ...(tools ? { tools } : {}),
        };

        const response = await this.client.chat(chatRequest);

        let content = "";
        const toolCalls: Array<{
          id: string;
          function: { name: string; arguments: Record<string, unknown> };
        }> = [];
        let markdownOutputId: string | null = null;

        // Stream the response
        for await (const chunk of response) {
          const message = chunk.message;

          if (message.content) {
            // Handle content streaming
            if (!markdownOutputId) {
              // Start new markdown output
              const metadata: AnodeCellMetadata = {
                role: "assistant",
                ai_provider: "ollama",
                ai_model: model,
                iteration: iteration + 1,
              };
              markdownOutputId = context.markdown(message.content, {
                anode: metadata,
              });
            } else {
              // Append to existing markdown output
              context.appendMarkdown(markdownOutputId, message.content);
            }
            content += message.content;
          }

          if (message.tool_calls) {
            // Handle tool calls
            for (const toolCall of message.tool_calls) {
              if (toolCall.function) {
                const toolCallId = `call_${Date.now()}_${
                  Math.random().toString(36).substr(2, 9)
                }`;
                toolCalls.push({
                  id: toolCallId,
                  function: {
                    name: toolCall.function.name,
                    arguments: toolCall.function.arguments,
                  },
                });
              }
            }
          }
        }

        // Add assistant message to conversation
        const assistantMessage: OllamaChatMessage = {
          role: "assistant",
          content: content || "",
          ...(toolCalls && toolCalls.length > 0
            ? {
              tool_calls: toolCalls.map((tc) => ({
                function: {
                  name: tc.function.name,
                  arguments: tc.function.arguments,
                },
              })),
            }
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
            try {
              this.logger.info(`Calling tool: ${toolCall.function.name}`, {
                args: toolCall.function.arguments,
                iteration: iteration + 1,
              });

              // Execute the tool call and get result
              const toolResult = await onToolCall({
                id: toolCall.id,
                name: toolCall.function.name,
                arguments: toolCall.function.arguments,
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
                arguments: toolCall.function.arguments,
                status: "success",
                timestamp: new Date().toISOString(),
                result: toolResult,
              };

              const successMetadata: AnodeCellMetadata = {
                role: "function_call",
                tool_call: true,
                tool_name: toolCall.function.name,
                tool_args: toolCall.function.arguments,
                iteration: iteration + 1,
              };

              const successOutput: OutputData = {
                type: "display_data",
                data: {
                  [AI_TOOL_CALL_MIME_TYPE]: toolCallData,
                  "text/markdown":
                    `🔧 **Tool executed**: \`${toolCall.function.name}\`\n\n${
                      formatToolCall(
                        toolCall.function.name,
                        toolCall.function.arguments,
                      )
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
                role: "user", // Ollama uses "user" role for tool results
                content: `Tool ${toolCall.function.name} result: ${
                  toolResult || "Success"
                }`,
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
                arguments: toolCall.function.arguments,
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
                role: "user", // Ollama uses "user" role for tool results
                content:
                  `Tool ${toolCall.function.name} error: ${errorMessage}`,
              });
            }
          }

          // Continue to next iteration to let AI respond to tool results
          iteration++;
          continue;
        }

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
          "anode/ai_provider": "ollama",
          "anode/ai_model": model,
          "anode/max_iterations_reached": true,
        });
      }
    } catch (error: unknown) {
      this.logger.error("Ollama API error in agentic conversation", error);

      let errorMessage = "Unknown error occurred";
      if (error && typeof error === "object") {
        const err = error as { message?: string; name?: string };
        if (err.message) {
          errorMessage = err.message;
        }
      }

      const errorOutputs = createErrorOutput(
        `Ollama API Error: ${errorMessage}`,
        "ollama",
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
            errorData.ename || "OllamaError",
            errorData.evalue || "Unknown error",
            errorData.traceback || ["Unknown error"],
          );
        }
      }
    }
  }
}

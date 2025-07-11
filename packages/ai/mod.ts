import stripAnsi from "strip-ansi";
import type OpenAI from "@openai/openai";

import type {
  AiModel,
  ExecutionContext,
  Logger,
  ModelCapability,
} from "@runt/lib";

import { handleToolCallWithResult } from "./tool-registry.ts";
import type {
  AiToolCallData,
  AiToolResultData,
  MediaContainer,
  Store,
} from "@runt/schema";
import { AI_TOOL_CALL_MIME_TYPE, AI_TOOL_RESULT_MIME_TYPE } from "@runt/schema";
import { createLogger } from "@runt/lib";

import { OpenAIClient } from "./openai-client.ts";
import { RuntOllamaClient } from "./ollama-client.ts";

// Import and export AI-specific media utilities
import {
  type AIMediaBundle,
  ensureTextPlainFallback,
  extractStructuredData,
  hasVisualContent,
  type RichOutputData,
  toAIContext,
  toAIMediaBundle,
} from "./media-utils.ts";

// Re-export for external use
export {
  type AIMediaBundle,
  ensureTextPlainFallback,
  extractStructuredData,
  hasVisualContent,
  type RichOutputData,
  toAIContext,
  toAIMediaBundle,
};

// Export notebook context functions
export { gatherNotebookContext } from "./notebook-context.ts";

// Create logger for AI conversation debugging
const logger = createLogger("ai-conversation");

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// Extended message type for rich multimedia content
export interface RichChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content:
    | string
    | Array<{
      type: "text" | "image_url";
      text?: string;
      image_url?: {
        url: string;
        detail?: "low" | "high" | "auto";
      };
    }>;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
  // Preserve original multimedia data for AI clients that can handle it
  multimedia?: {
    [mimeType: string]: unknown;
  };
}

// Helper types for accessing tool call properties
type ChatMessageWithToolCalls = ChatMessage & {
  role: "assistant";
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

type ChatMessageWithToolCallId = ChatMessage & {
  role: "tool";
  tool_call_id: string;
};

// Use schema types for tool data
export type ToolResultData = AiToolResultData;
export type ToolCallData = AiToolCallData;

export interface NotebookContextData {
  previousCells: CellContextData[];
  totalCells: number;
  currentCellPosition: number;
}

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
    data: unknown;
    metadata?: Record<string, unknown>;
    representations?: Record<string, MediaContainer>;
  }>;
}

/**
 * Convert notebook context to conversation messages with sequential tool call flow
 */
export function buildConversationMessages(
  context: NotebookContextData,
  systemPrompt: string,
  userPrompt: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  logger.debug("Building conversation messages", {
    totalCells: context.totalCells,
    previousCellsCount: context.previousCells.length,
    currentPosition: context.currentCellPosition,
  });

  messages.push({
    role: "system" as const,
    content: systemPrompt,
  });

  // Process each cell in order, building sequential conversation
  context.previousCells.forEach((cell, cellIndex) => {
    logger.debug(
      `Processing cell ${cellIndex + 1}/${context.previousCells.length}`,
      {
        cellId: cell.id,
        cellType: cell.cellType,
        outputCount: cell.outputs?.length || 0,
        position: cell.position,
      },
    );
    if (cell.cellType === "ai" && cell.outputs && cell.outputs.length > 0) {
      // Process AI cell outputs sequentially - each output becomes a message
      cell.outputs.forEach((output) => {
        const metadata = output.metadata as { anode?: { role?: string } };
        const role = metadata?.anode?.role;

        // Handle markdown outputs from AI cells (streaming text responses)
        if (
          output.outputType === "markdown" &&
          output.data &&
          typeof output.data === "string" &&
          metadata?.anode?.role === "assistant"
        ) {
          // Assistant markdown response
          const markdownContent = String(output.data);
          messages.push({
            role: "assistant" as const,
            content: markdownContent,
          });
        } else if (
          role === "assistant" && output.data &&
          typeof output.data === "object" && "text/markdown" in output.data
        ) {
          // Assistant text response from display_data
          const markdownContent = String(
            (output.data as Record<string, unknown>)["text/markdown"],
          );
          messages.push({
            role: "assistant" as const,
            content: markdownContent,
          });
        } else if (role === "function_call") {
          // Tool call - create assistant message with tool_calls
          const toolData = output.data && typeof output.data === "object" &&
              AI_TOOL_CALL_MIME_TYPE in output.data
            ? (output.data as Record<string, unknown>)[
              AI_TOOL_CALL_MIME_TYPE
            ] as AiToolCallData
            : null;
          if (toolData) {
            messages.push({
              role: "assistant" as const,
              content: "", // Empty content for pure tool call
              tool_calls: [{
                id: toolData.tool_call_id,
                type: "function" as const,
                function: {
                  name: toolData.tool_name,
                  arguments: JSON.stringify(toolData.arguments),
                },
              }],
            });
          }
        } else if (role === "tool") {
          // Tool result
          const resultData = output.data && typeof output.data === "object" &&
              AI_TOOL_RESULT_MIME_TYPE in output.data
            ? (output.data as Record<string, unknown>)[
              AI_TOOL_RESULT_MIME_TYPE
            ] as AiToolResultData
            : null;
          if (resultData) {
            messages.push({
              role: "tool" as const,
              content: resultData.result || "Success",
              tool_call_id: resultData.tool_call_id,
            });
          }
        }
      });
    } else if (cell.cellType === "code" || cell.cellType === "sql") {
      // Code/SQL cells become user messages with cell ID and outputs
      let cellMessage = `Notebook ${cell.cellType} cell ${cell.id}:\n\`\`\`${
        cell.cellType === "sql" ? "sql" : "python"
      }\n${cell.source}\n\`\`\``;

      if (cell.outputs && cell.outputs.length > 0) {
        cellMessage += `\n\nOutput:\n`;
        cell.outputs.forEach((output) => {
          if (output.outputType === "terminal" && output.data) {
            // Handle both old format (data.text) and new format (data as string)
            const terminalText = typeof output.data === "object" &&
                output.data !== null && "text" in output.data
              ? String((output.data as Record<string, unknown>).text)
              : String(output.data);
            cellMessage += `\`\`\`\n${stripAnsi(terminalText)}\`\`\`\n`;
          } else if (
            (output.outputType === "execute_result" ||
              output.outputType === "display_data") &&
            output.data && typeof output.data === "object"
          ) {
            // Handle execute_result and display_data outputs
            const outputData = output.data as Record<string, unknown>;
            if (outputData["text/plain"]) {
              cellMessage += `\`\`\`\n${
                stripAnsi(String(outputData["text/plain"]))
              }\n\`\`\`\n`;
            }
            if (outputData["text/markdown"]) {
              cellMessage += `${outputData["text/markdown"]}\n`;
            }
          } else if (
            output.outputType === "error" && output.data
          ) {
            try {
              const errorData = typeof output.data === "string"
                ? JSON.parse(output.data)
                : output.data;
              cellMessage += `\`\`\`\nError: ${
                stripAnsi(String(errorData.ename || "Unknown"))
              }: ${
                stripAnsi(String(errorData.evalue || "Unknown error"))
              }\n\`\`\`\n`;
            } catch {
              cellMessage += `\`\`\`\nError: ${
                stripAnsi(String(output.data))
              }\n\`\`\`\n`;
            }
          } else if (
            output.outputType === "markdown" && output.data
          ) {
            cellMessage += `${output.data}\n`;
          } else if (
            (output.outputType === "multimedia_result" ||
              output.outputType === "multimedia_display") &&
            output.representations
          ) {
            // Handle MediaContainer representations (at top level, not in data)
            const representations = output.representations;

            logger.debug("Found multimedia representations", {
              cellId: cell.id,
              outputType: output.outputType,
              mimeTypes: Object.keys(representations),
              hasMarkdown: !!representations["text/markdown"],
              hasPlain: !!representations["text/plain"],
              markdownType: representations["text/markdown"]?.type,
              plainType: representations["text/plain"]?.type,
            });

            // Preserve full multimedia data for AI providers that support it
            const aiBundle = toAIMediaBundle(representations as RichOutputData);
            const hasRichContent = Object.keys(aiBundle).length > 0;

            if (hasRichContent) {
              logger.debug(
                "Adding multimedia content to conversation",
                {
                  cellId: cell.id,
                  mimeTypes: Object.keys(aiBundle),
                  hasMarkdown: !!aiBundle["text/markdown"],
                  hasPlain: !!aiBundle["text/plain"],
                  hasImages: Object.keys(aiBundle).some((type) =>
                    type.startsWith("image/")
                  ),
                  hasJson: !!aiBundle["application/json"],
                },
              );

              // Prioritize markdown for structured text, but preserve other formats
              if (aiBundle["text/markdown"]) {
                cellMessage += `${aiBundle["text/markdown"]}\n`;
              } else if (aiBundle["text/plain"]) {
                cellMessage += `${aiBundle["text/plain"]}\n`;
              }

              // Include structured data as formatted JSON
              if (aiBundle["application/json"]) {
                try {
                  const jsonContent = JSON.stringify(
                    aiBundle["application/json"],
                    null,
                    2,
                  );
                  cellMessage +=
                    `\n**Structured Data:**\n\`\`\`json\n${jsonContent}\n\`\`\`\n`;
                } catch {
                  cellMessage += `\n**Structured Data:** ${
                    String(aiBundle["application/json"])
                  }\n`;
                }
              }

              // Note presence of visual content for AI awareness
              if (
                Object.keys(aiBundle).some((type) => type.startsWith("image/"))
              ) {
                cellMessage += `\n**Visual Content:** ${
                  Object.keys(aiBundle).filter((type) =>
                    type.startsWith("image/")
                  ).join(", ")
                } (available for vision-capable models)\n`;
              }
            }
          }

          // Future: Add image/multimodal support here
          // if (output.data["image/png"]) {
          //   cellMessage += `[Image output displayed]\n`;
          // }
        });
      }

      messages.push({
        role: "user" as const,
        content: cellMessage,
      });
    } else if (cell.cellType === "markdown") {
      // Markdown cells become user messages with cell ID
      messages.push({
        role: "user" as const,
        content: `Notebook markdown cell ${cell.id}:\n${cell.source}`,
      });
    }
  });

  // Add the current user prompt
  messages.push({
    role: "user" as const,
    content: userPrompt,
  });

  logger.debug("Conversation messages built successfully", {
    totalMessages: messages.length,
    systemMessages: messages.filter((m) => m.role === "system").length,
    userMessages: messages.filter((m) => m.role === "user").length,
    assistantMessages: messages.filter((m) => m.role === "assistant").length,
    toolMessages: messages.filter((m) => m.role === "tool").length,
  });

  return messages;
}

const getDefaultModel = (provider: string): string => {
  return DEFAULT_MODELS[provider as keyof typeof DEFAULT_MODELS] ||
    DEFAULT_MODELS.openai;
};

/**
 * Execute AI prompts using OpenAI, Ollama, or other providers
 */
// Export the AI clients for external use
export { OpenAIClient, RuntOllamaClient };

/**
 * Discover available AI models from all configured providers
 */
export async function discoverAvailableAiModels(): Promise<AiModel[]> {
  const allModels: AiModel[] = [];

  // Discover OpenAI models
  const openaiClient = new OpenAIClient();
  try {
    const openaiModels = await openaiClient.discoverAiModels();
    allModels.push(...openaiModels);
  } catch (_error) {
    console.warn(
      "Failed to discover OpenAI models - API may not be configured",
    );
  }

  // Discover Ollama models
  const ollamaHost = Deno.env.get("OLLAMA_HOST") || "http://localhost:11434";
  const ollamaClient = new RuntOllamaClient({
    host: ollamaHost,
  });
  try {
    const ollamaModels = await ollamaClient.discoverAiModels();
    allModels.push(...ollamaModels);
  } catch (_error) {
    console.warn(
      "Failed to discover Ollama models - server may not be running",
    );
  }

  return allModels;
}

/**
 * Filter AI models by required capabilities
 */
export function filterModelsByCapabilities(
  models: AiModel[],
  requiredCapabilities: string[],
): AiModel[] {
  return models.filter((model) =>
    requiredCapabilities.every((capability) =>
      model.capabilities.includes(capability as ModelCapability)
    )
  );
}

// Default models for each provider
const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  ollama: "llama3.1",
} as const;

export async function executeAI(
  context: ExecutionContext,
  notebookContext: NotebookContextData,
  logger: Logger,
  store: Store,
  sessionId: string,
): Promise<{ success: boolean; error?: string }> {
  const {
    cell,
    stderr,
    result: _result,
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

    const provider = cell.aiProvider || "openai";
    const model = cell.aiModel || getDefaultModel(provider);

    logger.info("Executing AI prompt", {
      cellId: cell.id,
      provider,
      model,
      promptLength: prompt.length,
    });

    // Initialize AI clients based on provider
    const openaiClient = new OpenAIClient();

    // Configure Ollama client with environment-aware host detection
    const ollamaHost = Deno.env.get("OLLAMA_HOST") || "http://localhost:11434";
    const ollamaClient = new RuntOllamaClient({
      host: ollamaHost,
    });

    if (provider === "ollama") {
      // Use Ollama client
      const isOllamaReady = await ollamaClient.isReady();

      if (isOllamaReady) {
        const openaiMessages = buildConversationMessages(
          notebookContext,
          "You are an AI assistant in a collaborative notebook environment. You can see all cell outputs (including terminal text, plots, tables, and errors) from code that has been executed. You can also execute code yourself using tool calls. Use the visible outputs and your execution capabilities to help analyze data and answer questions.",
          prompt,
        );

        // Convert OpenAI message format to Ollama message format
        const conversationMessages = openaiMessages.map((
          msg,
        ): { role: string; content: string } => ({
          role: msg.role,
          content: typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content),
        }));

        logger.debug("Conversation messages for Ollama", {
          cellId: cell.id,
          messageCount: conversationMessages.length,
          provider: "ollama",
          model,
        });

        await ollamaClient.generateAgenticResponse(
          conversationMessages,
          context,
          {
            model,
            provider: "ollama",
            enableTools: true,
            currentCellId: cell.id,
            maxIterations: 10,
            interruptSignal: abortSignal,
            onToolCall: async (toolCall) => {
              logger.info("AI requested tool call", {
                toolName: toolCall.name,
                cellId: cell.id,
              });
              return await handleToolCallWithResult(
                store,
                logger,
                sessionId,
                cell,
                toolCall,
              );
            },
            onIteration: (iteration, messages) => {
              // Check if execution was cancelled
              if (abortSignal.aborted) {
                logger.info("AI conversation interrupted", {
                  iteration,
                  cellId: cell.id,
                });
                return Promise.resolve(false);
              }

              logger.info("AI conversation iteration", {
                iteration: iteration + 1,
                messageCount: messages.length,
                cellId: cell.id,
              });

              return Promise.resolve(true);
            },
          },
        );

        logger.info("Ollama conversation completed");
      } else {
        // Show Ollama configuration help
        const configMessage = `# Ollama Configuration Required

Ollama is not available at \`${ollamaHost}\`. To use Ollama models, you need to:

## Setup Instructions

1. **Install Ollama**: Visit [ollama.ai](https://ollama.ai/) and follow the installation instructions
2. **Start Ollama server**: Run \`ollama serve\`
3. **Pull models**: Download models with \`ollama pull llama3.1\`

## Environment Configuration

Current Ollama host: \`${ollamaHost}\`

To use a different host, set the environment variable:
\`\`\`bash
export OLLAMA_HOST=http://your-ollama-host:11434
\`\`\`

## Available Models

- \`llama3.1\` - General purpose model (8B parameters)
- \`llama3.1:70b\` - Large general purpose model (70B parameters)
- \`mistral\` - Fast and efficient (7B parameters)
- \`codellama\` - Optimized for coding tasks (7B parameters)
- \`qwen2.5\` - Multilingual model (7B parameters)
- \`qwen2.5:32b\` - Large multilingual model (32B parameters)
- \`gemma2\` - Google's Gemma model (9B parameters)
- \`deepseek-coder\` - Specialized coding model (6.7B parameters)
- \`phi3\` - Microsoft's compact model (3.8B parameters)

The system will automatically pull models if they're not available locally.`;

        context.display({
          "text/markdown": configMessage,
          "text/plain": configMessage.replace(/[#*`]/g, "").replace(
            /\n+/g,
            "\n",
          ).trim(),
        }, {
          "anode/ai_config_help": true,
          "anode/ai_provider": "ollama",
          "anode/ollama_host": ollamaHost,
        });
      }
    } else if (
      openaiClient.isReady() &&
      (provider === "openai" || !provider)
    ) {
      // Use conversation-based approach for better AI interaction
      const conversationMessages = buildConversationMessages(
        notebookContext,
        "You are an AI assistant in a collaborative notebook environment. You can see all cell outputs (including terminal text, plots, tables, and errors) from code that has been executed. You can also execute code yourself using tool calls. Use the visible outputs and your execution capabilities to help analyze data and answer questions.",
        prompt,
      );

      logger.debug("Conversation messages for OpenAI", {
        cellId: cell.id,
        messageCount: conversationMessages.length,
        messages: conversationMessages.map((msg, idx) => ({
          index: idx,
          role: msg.role,
          contentLength: msg.content?.length || 0,
          fullContent: msg.content || "",
          hasToolCalls: !!(msg as ChatMessageWithToolCalls).tool_calls,
          toolCallCount: (msg as ChatMessageWithToolCalls).tool_calls?.length ||
            0,
          toolCallId: (msg as ChatMessageWithToolCallId).tool_call_id || null,
        })),
      });

      await openaiClient.generateAgenticResponse(
        conversationMessages,
        context,
        {
          model,
          provider,
          enableTools: true,
          currentCellId: cell.id,
          maxIterations: 10,
          interruptSignal: abortSignal,
          onToolCall: async (toolCall) => {
            logger.info("AI requested tool call", {
              toolName: toolCall.name,
              cellId: cell.id,
            });
            return await handleToolCallWithResult(
              store,
              logger,
              sessionId,
              cell,
              toolCall,
            );
          },
          onIteration: (iteration, messages) => {
            // Check if execution was cancelled
            if (abortSignal.aborted) {
              logger.info("AI conversation interrupted", {
                iteration,
                cellId: cell.id,
              });
              return Promise.resolve(false);
            }

            logger.info("AI conversation iteration", {
              iteration: iteration + 1,
              messageCount: messages.length,
              cellId: cell.id,
            });

            return Promise.resolve(true);
          },
        },
      );

      logger.info("OpenAI conversation completed");
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

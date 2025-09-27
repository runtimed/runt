import stripAnsi from "strip-ansi";
import type OpenAI from "@openai/openai";

import type {
  AiModel,
  ExecutionContext,
  ModelCapability,
} from "@runtimed/agent-core";

import { handleToolCallWithResult } from "./tool-registry.ts";
import type {
  AiToolCallData,
  AiToolResultData,
  MediaContainer,
} from "@runt/schema";
import type { CellReference, Store } from "jsr:@runtimed/schema";
import {
  AI_TOOL_CALL_MIME_TYPE,
  AI_TOOL_RESULT_MIME_TYPE,
} from "jsr:@runtimed/schema";
import { logger } from "@runtimed/agent-core";

import { OpenAIClient } from "./openai-client.ts";
import { RuntOllamaClient } from "./ollama-client.ts";
import { AnacondaAIClient, GroqClient } from "./groq-client.ts";
import type { NotebookTool } from "./tool-registry.ts";

export type { NotebookTool };

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

// Use global logger instance for AI conversation debugging

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
export type { CellReference };

export interface NotebookContextData {
  previousCells: CellContextData[];
  totalCells: number;
  currentCellFractionalIndex: string;
}

/**
 * Type definitions for AI context generation - exported for reuse in other runtime agents
 */
export interface CellContextData {
  id: string;
  cellType: string;
  source: string;
  fractionalIndex: string;
  outputs: Array<{
    outputType: string;
    data: unknown;
    metadata?: Record<string, unknown>;
    representations?: Record<string, MediaContainer>;
  }>;
}

/**
 * Create system prompt with optional current cell ID context for tool usage
 */
function createSystemPrompt(
  currentCellId?: string,
  filepaths?: string[],
  vectorStoreEnabled: boolean = false,
  userSystemPrompt: string = "",
): string {
  let prompt = `You are an AI assistant in a collaborative notebook environment.

You have the full context of all cells (code, ai, and markdown) above your current cell.
You can see all cell outputs (including terminal text, plots, tables, and errors) from code that has been executed.
You can also execute code yourself using tool calls.
When you write code use caution not to double encode new lines.
Use the visible outputs and your execution capabilities to help analyze data and answer questions.
You should carefully review the code you've written and the output it produces.
Devise metrics by which you can evaluate the quality of your code and the results it produces.
After executing code cells you should review the code and make changes to improve the result.

`;

  if (userSystemPrompt) {
    prompt += `\n\n${userSystemPrompt}\n`;
  }

  const vectorStoreExtras =
    `IMPORTANT: If you have access to vector store tools (query_documents, find_mounted_file,
list_indexed_files),
use them to search and access mounted files rather than asking the user to provide files manually. These tools
can search file contents and find file paths from mounted directories.

When working with data files:
2. Use query_documents to search file contents for specific information
3. Use list_indexed_files to see what files are available

Should you need to write data for any reason you will only be able to write to the /outputs directory.`;

  if (vectorStoreEnabled) {
    prompt += vectorStoreExtras;
  }

  if (currentCellId) {
    prompt +=
      ` Your current cell ID is: ${currentCellId}. When using the create_cell tool, use this ID as the after_id
parameter to place new cells below yourself.`;
  }

  // Add file path context if provided
  if (filepaths && filepaths.length > 0) {
    prompt += `\n\n${
      filepaths.map((path) =>
        `The following question directly pertains to ${path} which you can query using the query tool.`
      ).join("\n")
    }`;
  }

  return prompt;
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
    currentFractionalIndex: context.currentCellFractionalIndex,
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
        fractionalIndex: cell.fractionalIndex,
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
// Export the AI clients and MCP client for external use
export { OpenAIClient, RuntOllamaClient };
export { closeMCPClient, getMCPClient, MCPClient } from "./mcp-client.ts";
export { getAllTools } from "./tool-registry.ts";
export {
  getVectorStore,
  isVectorStoreIndexingEnabled,
  VectorStoreService,
} from "./vector-store.ts";

const AI_ClIENTS: { [key: string]: OpenAIClient | RuntOllamaClient } = {
  anaconda: new AnacondaAIClient(),
  openai: new OpenAIClient(),
  groq: new GroqClient(),
  ollama: new RuntOllamaClient(),
} as const;

/**
 * Discover available AI models from all configured providers
 */
export async function discoverAvailableAiModels(): Promise<AiModel[]> {
  const allModels: AiModel[] = [];

  for (const client of Object.values(AI_ClIENTS)) {
    try {
      const models = await client.discoverAiModels();
      allModels.push(...models);
    } catch (_error) {
      console.warn(
        `Failed to discover ${client.provider} models - API may not be configured`,
      );
    }
  }

  logger.debug(`Discovered AI models`, {
    allModels: allModels,
  });
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
  groq: "moonshot/kimi-k2-instruct-0905",
  ollama: "llama3.1",
} as const;

export type AIExecutionContext = ExecutionContext & {
  sendWorkerMessage?: (type: string, data: unknown) => Promise<unknown>;
};

export async function executeAI(
  context: AIExecutionContext,
  notebookContext: NotebookContextData,
  store: Store,
  sessionId: string,
  notebookTools: NotebookTool[] = [],
  maxIterations: number = 10,
  userSystemPrompt: string = "",
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

    const { isVectorStoreIndexingEnabled } = await import("./vector-store.ts");

    // Extract file path references from the prompt (pattern: @/path/to/file)
    const filePathPattern = /@([^\s]+)/g;
    const filePathMatches = prompt.match(filePathPattern);
    const extractedFilePaths = filePathMatches
      ? filePathMatches.map((match) => match.substring(1)) // Remove the @ symbol
      : [];

    const provider = cell.aiProvider || "openai";
    const model = cell.aiModel || getDefaultModel(provider);

    logger.info("Executing AI prompt", {
      cellId: cell.id,
      provider,
      model,
      promptLength: prompt.length,
    });

    let client;
    try {
      client = AI_ClIENTS[provider];
      if (!client) {
        throw new Error(`No AI client found for provider: ${provider}`);
      }
    } catch (err) {
      logger.error(`Failed to get AI client for provider ${provider}:`, err);
      throw err;
    }
    if (client.isReady()) {
      client.setNotebookTools(notebookTools);

      const conversationMessages = buildConversationMessages(
        notebookContext,
        createSystemPrompt(
          cell.id,
          extractedFilePaths,
          isVectorStoreIndexingEnabled(),
          userSystemPrompt,
        ),
        prompt,
      );

      logger.debug(`123123 Conversation messages for ${provider}`, {
        cellId: cell.id,
        provider: provider,
        model: model,
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

      await client.generateAgenticResponse(
        conversationMessages,
        context,
        {
          model: model,
          provider: provider,
          enableTools: true,
          maxIterations: maxIterations,
          interruptSignal: abortSignal,
          onToolCall: async (toolCall) => {
            logger.info("AI requested tool call", {
              toolName: toolCall.name,
              cellId: cell.id,
            });
            return await handleToolCallWithResult(
              store,
              sessionId,
              cell,
              toolCall,
              context.sendWorkerMessage,
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
      logger.info(`${provider} conversation completed`);
    } else {
      // Show provider configuration help
      const configMessage = client.getConfigMessage();
      context.display({
        "text/markdown": client.getConfigMessage(),
        "text/plain": configMessage.replace(/[#*`]/g, "").replace(
          /\n+/g,
          "\n",
        ).trim(),
      }, {
        "anode/ai_config_help": true,
        "anode/ai_provider": provider,
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

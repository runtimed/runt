import stripAnsi from "strip-ansi";
import type OpenAI from "@openai/openai";

import type {
  AiModel,
  ExecutionContext,
  Logger,
  ModelCapability,
} from "@runt/lib";

import { handleToolCallWithResult } from "./tool-registry.ts";
import type { Store } from "@runt/schema";

import { OpenAIClient } from "./openai-client.ts";
import { RuntOllamaClient } from "./ollama-client.ts";

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

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

interface ToolResultData {
  tool_call_id: string;
  result?: string;
  status: string;
}

export interface ToolCallData {
  tool_call_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  status: "success" | "error";
  timestamp: string;
  execution_time_ms?: number;
}

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
    data: Record<string, unknown>;
    metadata?: Record<string, unknown>;
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

  messages.push({
    role: "system" as const,
    content: systemPrompt,
  });

  // Process each cell in order, building sequential conversation
  context.previousCells.forEach((cell) => {
    if (cell.cellType === "ai" && cell.outputs && cell.outputs.length > 0) {
      // Process AI cell outputs sequentially - each output becomes a message
      cell.outputs.forEach((output) => {
        const metadata = output.metadata as { anode?: { role?: string } };
        const role = metadata?.anode?.role;

        if (role === "assistant" && output.data["text/markdown"]) {
          // Assistant text response
          messages.push({
            role: "assistant" as const,
            content: String(output.data["text/markdown"]),
          });
        } else if (role === "function_call") {
          // Tool call - create assistant message with tool_calls
          const toolData = output
            .data["application/vnd.anode.aitool+json"] as ToolCallData;
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
        } else if (role === "tool") {
          // Tool result
          const resultData = output
            .data["application/vnd.anode.aitool.result+json"] as ToolResultData;
          messages.push({
            role: "tool" as const,
            content: resultData.result || "Success",
            tool_call_id: resultData.tool_call_id,
          });
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
          if (output.outputType === "stream" && output.data.text) {
            cellMessage += `\`\`\`\n${
              stripAnsi(String(output.data.text))
            }\`\`\`\n`;
          } else if (
            output.outputType === "error" && output.data.ename &&
            output.data.evalue
          ) {
            cellMessage += `\`\`\`\nError: ${
              stripAnsi(String(output.data.ename))
            }: ${stripAnsi(String(output.data.evalue))}\n\`\`\`\n`;
          } else if (
            (output.outputType === "execute_result" ||
              output.outputType === "display_data") &&
            output.data["text/plain"]
          ) {
            cellMessage += `\`\`\`\n${
              stripAnsi(String(output.data["text/plain"]))
            }\n\`\`\`\n`;
          }
          if (output.data["text/markdown"]) {
            cellMessage += `${output.data["text/markdown"]}\n`;
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
  openai: "o4-mini",
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
          "This is a pyodide based notebook environment with assistant and user access to the same runtime. Users see and edit the same notebook as you. When you execute cells, the user sees the output as well",
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
        "This is a pyodide based notebook environment with assistant and user access to the same runtime. Users see and edit the same notebook as you. When you execute cells, the user sees the output as well",
        prompt,
      );

      logger.debug("Conversation messages for OpenAI", {
        cellId: cell.id,
        messageCount: conversationMessages.length,
        messages: conversationMessages.map((msg, idx) => ({
          index: idx,
          role: msg.role,
          contentLength: msg.content?.length || 0,
          contentPreview: msg.content?.slice(0, 100) || "",
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

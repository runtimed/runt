import stripAnsi from "strip-ansi";
import type OpenAI from "@openai/openai";

import type { ExecutionContext, Logger } from "@runt/lib";

import { handleToolCallWithResult } from "./tool-registry.ts";
import type { Store } from "@runt/schema";

import { OpenAIClient } from "./openai-client.ts";

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

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
 * Convert notebook context to conversation messages for more natural AI interaction
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

  if (context.previousCells.length > 0) {
    // Add notebook context as a structured user message
    let contextMessage = `Current state of the notebook:\n\n`;

    context.previousCells.forEach((cell, index) => {
      if (cell.cellType === "code") {
        contextMessage += `**Code cell ${
          index + 1
        } (ID: ${cell.id}):**\n\`\`\`python\n${cell.source}\n\`\`\`\n`;

        if (cell.outputs && cell.outputs.length > 0) {
          contextMessage += `Output:\n`;
          cell.outputs.forEach((output) => {
            if (output.outputType === "stream" && output.data.text) {
              contextMessage += `\`\`\`\n${
                stripAnsi(String(output.data.text))
              }\`\`\`\n`;
            } else if (
              output.outputType === "error" && output.data.ename &&
              output.data.evalue
            ) {
              contextMessage += `\`\`\`\nError: ${
                stripAnsi(String(output.data.ename))
              }: ${stripAnsi(String(output.data.evalue))}\n\`\`\`\n`;
            } else if (
              (output.outputType === "execute_result" ||
                output.outputType === "display_data") &&
              output.data["text/plain"]
            ) {
              contextMessage += `\`\`\`\n${
                stripAnsi(String(output.data["text/plain"]))
              }\n\`\`\`\n`;
            }
            if (output.data["text/markdown"]) {
              contextMessage += `${output.data["text/markdown"]}\n`;
            }
          });
        }
        contextMessage += `\n`;
      } else if (cell.cellType === "ai") {
        // Reconstruct conversation from AI cell outputs with proper ordering
        if (cell.outputs && cell.outputs.length > 0) {
          // Group outputs by iteration to maintain tool call/response order
          const outputsByIteration = new Map<number, typeof cell.outputs>();

          cell.outputs.forEach((output) => {
            const metadata = output.metadata as {
              anode?: { iteration?: number };
            };
            const iteration = metadata?.anode?.iteration || 1;

            if (!outputsByIteration.has(iteration)) {
              outputsByIteration.set(iteration, []);
            }
            outputsByIteration.get(iteration)!.push(output);
          });

          // Process outputs in iteration order
          const sortedIterations = Array.from(outputsByIteration.keys()).sort(
            (a, b) => a - b,
          );

          for (const iteration of sortedIterations) {
            const iterationOutputs = outputsByIteration.get(iteration)!;

            // Find assistant response and tool calls for this iteration
            const assistantOutput = iterationOutputs.find((o) => {
              const metadata = o.metadata as { anode?: { role?: string } };
              return metadata?.anode?.role === "assistant" &&
                o.data["text/markdown"];
            });

            const toolCallOutputs = iterationOutputs.filter((o) => {
              const metadata = o.metadata as { anode?: { role?: string } };
              return metadata?.anode?.role === "function_call";
            });

            const toolResultOutputs = iterationOutputs.filter((o) => {
              const metadata = o.metadata as { anode?: { role?: string } };
              return metadata?.anode?.role === "tool";
            });

            // Add assistant response (possibly with tool calls)
            if (assistantOutput || toolCallOutputs.length > 0) {
              const assistantMessage: ChatMessage = {
                role: "assistant" as const,
                content: assistantOutput
                  ? String(assistantOutput.data["text/markdown"])
                  : "",
                ...(toolCallOutputs.length > 0
                  ? {
                    tool_calls: toolCallOutputs.map(
                      (output) => {
                        const toolData = output
                          .data[
                            "application/vnd.anode.aitool+json"
                          ] as ToolCallData;
                        return {
                          id: toolData.tool_call_id,
                          type: "function" as const,
                          function: {
                            name: toolData.tool_name,
                            arguments: JSON.stringify(toolData.arguments),
                          },
                        };
                      },
                    ),
                  }
                  : {}),
              };

              messages.push(assistantMessage);

              // Add tool results if present
              toolResultOutputs.forEach((output) => {
                const resultData = output
                  .data[
                    "application/vnd.anode.aitool.result+json"
                  ] as ToolResultData;
                messages.push({
                  role: "tool" as const,
                  content: resultData.result || "Success",
                  tool_call_id: resultData.tool_call_id,
                });
              });
            }
          }
        } else {
          // Fallback to showing AI prompt as context if no outputs
          contextMessage +=
            `**Previous AI request (ID: ${cell.id}):**\n${cell.source}\n\n`;
        }
      } else if (cell.cellType === "markdown") {
        contextMessage += `**Markdown (ID: ${cell.id}):**\n${cell.source}\n\n`;
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

const defaultModel = "gpt-4o-mini";

/**
 * Execute AI prompts using OpenAI
 */
export async function executeAI(
  context: ExecutionContext,
  notebookContext: NotebookContextData,
  logger: Logger,
  store: Store,
  sessionId: string,
) {
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

    logger.info("Executing AI prompt", {
      cellId: cell.id,
      provider: cell.aiProvider || "openai",
      model: cell.aiModel || defaultModel,
      promptLength: prompt.length,
    });

    // Use real OpenAI API if configured, otherwise fall back to mock
    // Initialize OpenAI client on demand for AI cells only
    const openaiClient = new OpenAIClient();

    if (
      openaiClient.isReady() &&
      (cell.aiProvider === "openai" || !cell.aiProvider)
    ) {
      // Use conversation-based approach for better AI interaction
      const conversationMessages = buildConversationMessages(
        notebookContext,
        "This is a pyodide based notebook environment with assistant and user access to the same kernel. Users see and edit the same notebook as you. When you execute cells, the user sees the output as well",
        prompt,
      );

      await openaiClient.generateAgenticResponse(
        conversationMessages,
        context,
        {
          model: cell.aiModel || defaultModel,
          provider: cell.aiProvider || "openai",
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

      logger.info("AI conversation completed");
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

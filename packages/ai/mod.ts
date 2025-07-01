import stripAnsi from "strip-ansi";
import type OpenAI from "@openai/openai";

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

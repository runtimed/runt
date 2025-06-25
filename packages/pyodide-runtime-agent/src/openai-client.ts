import OpenAI from "@openai/openai";
import { createLogger } from "@runt/lib";

// Define message types inline to avoid import issues
type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

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
  execution_time_ms?: number;
}

interface OutputData {
  type: string;
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
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

  async generateResponseWithMessages(
    messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }>,
    options: {
      model?: string;
      provider?: string;
      maxTokens?: number;
      temperature?: number;
      enableTools?: boolean;
      currentCellId?: string;
      onToolCall?: (toolCall: ToolCall) => Promise<void>;
    } = {},
  ): Promise<OutputData[]> {
    if (!this.isReady()) {
      return this.createConfigHelpOutput();
    }

    const {
      model = "gpt-4o-mini",
      maxTokens = 2000,
      temperature = 0.7,
      enableTools = true,
      currentCellId: _currentCellId, // Prefix with underscore since it's unused
      onToolCall,
    } = options;

    try {
      this.logger.info(`Calling OpenAI API with model: ${model}`);

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
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: false,
        ...(tools ? { tools } : {}),
        ...(enableTools && tools ? { tool_choice: "auto" as const } : {}),
      });

      const message = response.choices[0]?.message;
      const content = message?.content;
      const toolCalls = message?.tool_calls;

      // Handle tool calls if present
      if (toolCalls && toolCalls.length > 0 && onToolCall) {
        this.logger.info(`Processing ${toolCalls.length} tool calls`);

        const outputs: OutputData[] = [];

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
              const errorToolCallData: ToolCallOutput = {
                tool_call_id: toolCall.id,
                tool_name: toolCall.function.name,
                arguments: { raw_arguments: toolCall.function.arguments },
                status: "error",
                timestamp: new Date().toISOString(),
              };

              outputs.push({
                type: "display_data",
                data: {
                  "application/vnd.anode.aitool+json": errorToolCallData,
                  "text/markdown":
                    `❌ **Tool failed**: \`${toolCall.function.name}\`\n\nError parsing arguments: ${parseError.message}`,
                  "text/plain":
                    `Tool failed: ${toolCall.function.name} - Error parsing arguments: ${parseError.message}`,
                },
                metadata: {
                  "anode/tool_call": true,
                  "anode/tool_name": toolCall.function.name,
                  "anode/tool_error": true,
                },
              });
              continue;
            }

            try {
              this.logger.info(`Calling tool: ${toolCall.function.name}`, {
                args,
              });

              // Execute the tool call
              await onToolCall({
                id: toolCall.id,
                name: toolCall.function.name,
                arguments: args,
              });

              // Add confirmation output with custom media type
              const toolCallData: ToolCallOutput = {
                tool_call_id: toolCall.id,
                tool_name: toolCall.function.name,
                arguments: args,
                status: "success",
                timestamp: new Date().toISOString(),
              };

              outputs.push({
                type: "display_data",
                data: {
                  "application/vnd.anode.aitool+json": toolCallData,
                  "text/markdown":
                    `🔧 **Tool executed**: \`${toolCall.function.name}\`\n\n${
                      this.formatToolCall(toolCall.function.name, args)
                    }`,
                  "text/plain": `Tool executed: ${toolCall.function.name}`,
                },
                metadata: {
                  "anode/tool_call": true,
                  "anode/tool_name": toolCall.function.name,
                  "anode/tool_args": args,
                },
              });
            } catch (error) {
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
              };

              outputs.push({
                type: "display_data",
                data: {
                  "application/vnd.anode.aitool+json": errorToolCallData,
                  "text/markdown":
                    `❌ **Tool failed**: \`${toolCall.function.name}\`\n\nError: ${
                      error instanceof Error ? error.message : String(error)
                    }`,
                  "text/plain": `Tool failed: ${toolCall.function.name} - ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                },
                metadata: {
                  "anode/tool_call": true,
                  "anode/tool_name": toolCall.function.name,
                  "anode/tool_error": true,
                },
              });
            }
          }
        }

        // If there's also text content, add it
        if (content) {
          outputs.push({
            type: "display_data",
            data: {
              "text/markdown": content,
              "text/plain": content,
            },
            metadata: {
              "anode/ai_response": true,
              "anode/ai_provider": "openai",
              "anode/ai_model": model,
              "anode/ai_with_tools": true,
            },
          });
        }

        return outputs;
      }

      // Regular text response
      if (!content) {
        return this.createErrorOutput("No response received from OpenAI API");
      }

      this.logger.info(
        `Received OpenAI response (${content.length} characters)`,
      );

      // Return the response as markdown output
      return [{
        type: "display_data",
        data: {
          "text/markdown": content,
          "text/plain": content,
        },
        metadata: {
          "anode/ai_response": true,
          "anode/ai_provider": "openai",
          "anode/ai_model": model,
          "anode/ai_usage": {
            prompt_tokens: response.usage?.prompt_tokens || 0,
            completion_tokens: response.usage?.completion_tokens || 0,
            total_tokens: response.usage?.total_tokens || 0,
          },
        },
      }];
    } catch (error: unknown) {
      this.logger.error("OpenAI API error", error);

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

      return this.createErrorOutput(`OpenAI API Error: ${errorMessage}`);
    }
  }

  async generateResponse(
    prompt: string,
    options: {
      model?: string;
      provider?: string;
      maxTokens?: number;
      temperature?: number;
      systemPrompt?: string;
      enableTools?: boolean;
      currentCellId?: string;
      onToolCall?: (toolCall: ToolCall) => Promise<void>;
    } = {},
  ): Promise<OutputData[]> {
    if (!this.isReady()) {
      return this.createConfigHelpOutput();
    }

    const {
      model = "gpt-4o-mini",
      maxTokens = 2000,
      temperature = 0.7,
      systemPrompt =
        `You are a helpful AI assistant in a Jupyter-like notebook environment. You can see the context of previous cells and their outputs.

**Your primary functions:**

1. **Create cells immediately** - When users want code, examples, or implementations, use the create_cell tool to add them to the notebook. Don't provide code blocks in markdown - create actual executable cells.

2. **Context awareness** - Reference previous cells and their outputs to provide relevant assistance. You can see what variables exist, what functions were defined, and what the current state is.

3. **Debug and optimize** - Help users debug errors, optimize code, or extend existing functionality based on what you can see in the notebook.

4. **Interpret outputs** - Respond based on execution results, error messages, plots, and data outputs from previous cells.

**Key behaviors:**
- CREATE cells instead of describing code
- Reference previous work when relevant
- Help debug based on actual errors you can see
- Suggest next steps based on notebook progression
- Use "after_current" positioning by default

Remember: Users want working code in their notebook, not explanations about code.`,
      enableTools = true,
      currentCellId: _currentCellId, // Prefix with underscore since it's unused
      onToolCall,
    } = options;

    try {
      this.logger.info(`Calling OpenAI API with model: ${model}`);

      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ];

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
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: false,
        ...(tools ? { tools } : {}),
        ...(enableTools && tools ? { tool_choice: "auto" as const } : {}),
      });

      const message = response.choices[0]?.message;
      const content = message?.content;
      const toolCalls = message?.tool_calls;

      // Handle tool calls if present
      if (toolCalls && toolCalls.length > 0 && onToolCall) {
        this.logger.info(`Processing ${toolCalls.length} tool calls`);

        const outputs: OutputData[] = [];

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
              const errorToolCallData: ToolCallOutput = {
                tool_call_id: toolCall.id,
                tool_name: toolCall.function.name,
                arguments: { raw_arguments: toolCall.function.arguments },
                status: "error",
                timestamp: new Date().toISOString(),
              };

              outputs.push({
                type: "display_data",
                data: {
                  "application/vnd.anode.aitool+json": errorToolCallData,
                  "text/markdown":
                    `❌ **Tool failed**: \`${toolCall.function.name}\`\n\nError parsing arguments: ${parseError.message}`,
                  "text/plain":
                    `Tool failed: ${toolCall.function.name} - Error parsing arguments: ${parseError.message}`,
                },
                metadata: {
                  "anode/tool_call": true,
                  "anode/tool_name": toolCall.function.name,
                  "anode/tool_error": true,
                },
              });
              continue;
            }

            try {
              this.logger.info(`Calling tool: ${toolCall.function.name}`, {
                args,
              });

              // Execute the tool call
              await onToolCall({
                id: toolCall.id,
                name: toolCall.function.name,
                arguments: args,
              });

              // Add confirmation output with custom media type
              const toolCallData: ToolCallOutput = {
                tool_call_id: toolCall.id,
                tool_name: toolCall.function.name,
                arguments: args,
                status: "success",
                timestamp: new Date().toISOString(),
              };

              outputs.push({
                type: "display_data",
                data: {
                  "application/vnd.anode.aitool+json": toolCallData,
                  "text/markdown":
                    `🔧 **Tool executed**: \`${toolCall.function.name}\`\n\n${
                      this.formatToolCall(toolCall.function.name, args)
                    }`,
                  "text/plain": `Tool executed: ${toolCall.function.name}`,
                },
                metadata: {
                  "anode/tool_call": true,
                  "anode/tool_name": toolCall.function.name,
                  "anode/tool_args": args,
                },
              });
            } catch (error) {
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
              };

              outputs.push({
                type: "display_data",
                data: {
                  "application/vnd.anode.aitool+json": errorToolCallData,
                  "text/markdown":
                    `❌ **Tool failed**: \`${toolCall.function.name}\`\n\nError: ${
                      error instanceof Error ? error.message : String(error)
                    }`,
                  "text/plain": `Tool failed: ${toolCall.function.name} - ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                },
                metadata: {
                  "anode/tool_call": true,
                  "anode/tool_name": toolCall.function.name,
                  "anode/tool_error": true,
                },
              });
            }
          }
        }

        // If there's also text content, add it
        if (content) {
          outputs.push({
            type: "display_data",
            data: {
              "text/markdown": content,
              "text/plain": content,
            },
            metadata: {
              "anode/ai_response": true,
              "anode/ai_provider": "openai",
              "anode/ai_model": model,
              "anode/ai_with_tools": true,
            },
          });
        }

        return outputs;
      }

      // Regular text response
      if (!content) {
        return this.createErrorOutput("No response received from OpenAI API");
      }

      this.logger.info(
        `Received OpenAI response (${content.length} characters)`,
      );

      // Return the response as markdown output
      return [{
        type: "display_data",
        data: {
          "text/markdown": content,
          "text/plain": content,
        },
        metadata: {
          "anode/ai_response": true,
          "anode/ai_provider": "openai",
          "anode/ai_model": model,
          "anode/ai_usage": {
            prompt_tokens: response.usage?.prompt_tokens || 0,
            completion_tokens: response.usage?.completion_tokens || 0,
            total_tokens: response.usage?.total_tokens || 0,
          },
        },
      }];
    } catch (error: unknown) {
      this.logger.error("OpenAI API error", error);

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

      return this.createErrorOutput(`OpenAI API Error: ${errorMessage}`);
    }
  }

  async generateStreamingResponse(
    prompt: string,
    options: {
      model?: string;
      provider?: string;
      maxTokens?: number;
      temperature?: number;
      systemPrompt?: string;
      onChunk?: (chunk: string) => void;
    } = {},
  ): Promise<OutputData[]> {
    if (!this.isReady()) {
      return this.createConfigHelpOutput();
    }

    const {
      model = "gpt-4o-mini",
      maxTokens = 2000,
      temperature = 0.7,
      systemPrompt =
        "You are a helpful AI assistant in a Jupyter-like notebook environment.",
      onChunk,
    } = options;

    try {
      this.logger.info(
        `Starting streaming call to OpenAI API with model: ${model}`,
      );

      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ];

      const stream = await this.client!.chat.completions.create({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: true,
      });

      let fullContent = "";

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          fullContent += content;
          if (onChunk) {
            onChunk(content);
          }
        }
      }

      this.logger.info(
        `Completed streaming OpenAI response (${fullContent.length} characters)`,
      );

      // Return the complete response as markdown output
      return [{
        type: "display_data",
        data: {
          "text/markdown": fullContent,
          "text/plain": fullContent,
        },
        metadata: {
          "anode/ai_response": true,
          "anode/ai_provider": "openai",
          "anode/ai_model": model,
          "anode/ai_streaming": true,
        },
      }];
    } catch (error: unknown) {
      this.logger.error("OpenAI streaming API error", error);

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

      return this.createErrorOutput(
        `OpenAI Streaming API Error: ${errorMessage}`,
      );
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

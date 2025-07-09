/**
 * Shared types for AI clients across all providers
 */

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallOutput {
  tool_call_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  status: "success" | "error";
  timestamp: string;
  result?: string;
}

export interface OutputData {
  type: "display_data" | "execute_result" | "error";
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AgenticOptions {
  maxIterations?: number;
  onIteration?: (
    iteration: number,
    messages: unknown[],
  ) => Promise<boolean>;
  interruptSignal?: AbortSignal;
}

export interface AnodeCellMetadata {
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

/**
 * Helper function to format tool calls consistently across providers
 */
export function formatToolCall(
  _toolName: string,
  args: Record<string, unknown>,
): string {
  const formattedArgs = Object.entries(args)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(", ");

  return `**Arguments**: ${formattedArgs}`;
}

/**
 * Helper function to create configuration help output
 */
export function createConfigHelpOutput(
  provider: string,
  requirements: string[],
): OutputData[] {
  return [{
    type: "display_data" as const,
    data: {
      "text/markdown": `## ${provider} Configuration Required\n\n${
        requirements.join("\n")
      }\n\nPlease configure ${provider} to use AI features.`,
      "text/plain": `${provider} configuration required: ${
        requirements.join(", ")
      }`,
    },
    metadata: {
      "anode/ai_config_help": true,
      "anode/ai_provider": provider.toLowerCase(),
    },
  }];
}

/**
 * Helper function to create error output
 */
export function createErrorOutput(
  message: string,
  provider?: string,
): OutputData[] {
  return [{
    type: "error" as const,
    data: {
      ename: `${
        provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : "AI"
      }Error`,
      evalue: message,
      traceback: [message],
    },
    metadata: {
      "anode/ai_error": true,
      ...(provider && { "anode/ai_provider": provider }),
    },
  }];
}

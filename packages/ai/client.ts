import { ExecutionContext, Logger } from "@runt/lib";
import {
  buildConversationMessages,
  NotebookContextData,
  OpenAIClient,
} from "@runt/ai";

// TODO: Move to the `@runt/ai` package
const defaultModel = "mistral-small3.2";

/**
 * Execute AI prompts using OpenAI
 */
export async function executeAI(
  context: ExecutionContext,
  notebookContext: NotebookContextData,
  logger: Logger,
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
    const openaiClient = new OpenAIClient({
      baseURL: "http://localhost:11434/v1/",
      // required but ignored
      apiKey: "ollama",
    });

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
            return await this.handleToolCallWithResult(cell, toolCall);
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

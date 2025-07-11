import { type CellData, events, type Store, tables } from "@runt/schema";
import type { Logger } from "@runt/lib";
import { createLogger } from "@runt/lib";

// Create logger for tool execution debugging
const toolLogger = createLogger("ai-tools");

interface NotebookTool {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, ToolParameter>;
    required: string[];
  };
}

interface ToolParameter {
  type: string;
  enum?: string[];
  description?: string;
  default?: string;
}

// Define available notebook tools
export const NOTEBOOK_TOOLS: NotebookTool[] = [
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

function calculateNewCellPosition(
  store: Store,
  currentCell: CellData,
  placement: string,
): number {
  const allCells = store.query(
    tables.cells.select().orderBy("position", "asc"),
  ) as CellData[];

  switch (placement) {
    case "before_current":
      return currentCell.position - 0.1;
    case "at_end": {
      const maxPosition = allCells.length > 0
        ? Math.max(...allCells.map((c: CellData) => c.position))
        : 0;
      return maxPosition + 1;
    }
    case "after_current":
    default:
      return currentCell.position + 0.1;
  }
}

export function createCell(
  store: Store,
  logger: Logger,
  sessionId: string,
  currentCell: CellData,
  args: Record<string, unknown>,
) {
  const cellType = String(args.cellType || "code");
  const content = String(args.content || "");
  const position = String(args.position || "after_current");

  // Calculate position for new cell
  const newPosition = calculateNewCellPosition(
    store,
    currentCell,
    position,
  );

  // Generate unique cell ID
  const newCellId = `cell-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  logger.info("Creating cell via AI tool call", {
    cellType,
    position: newPosition,
    contentLength: content.length,
  });

  // Create the new cell
  store.commit(
    events.cellCreated({
      id: newCellId,
      cellType: cellType as "code" | "markdown" | "raw" | "sql" | "ai",
      position: newPosition,
      createdBy: `ai-assistant-${sessionId}`,
    }),
  );

  // Set the cell source if provided
  if (content.length > 0) {
    store.commit(
      events.cellSourceChanged({
        id: newCellId,
        source: content,
        modifiedBy: `ai-assistant-${sessionId}`,
      }),
    );
  }

  logger.info("Created cell successfully", {
    cellId: newCellId,
    contentPreview: content.slice(0, 100),
  });

  return `Created ${cellType} cell: ${newCellId}`;
}

/**
 * Handle tool calls from AI with result return
 */
export async function handleToolCallWithResult(
  store: Store,
  logger: Logger,
  sessionId: string,
  currentCell: CellData,
  toolCall: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  },
): Promise<string> {
  const { name, arguments: args } = toolCall;

  switch (name) {
    case "create_cell": {
      return createCell(store, logger, sessionId, currentCell, args);
    }

    case "modify_cell": {
      const cellId = String(args.cellId || "");
      const content = String(args.content || "");

      if (!cellId) {
        logger.error("modify_cell: cellId is required");
        throw new Error("modify_cell: cellId is required");
      }

      // Check if cell exists
      const existingCell = store.query(
        tables.cells.select().where({ id: cellId }),
      )[0];

      if (!existingCell) {
        logger.error("modify_cell: Cell not found", { cellId });
        throw new Error(`modify_cell: Cell not found: ${cellId}`);
      }

      logger.info("Modifying cell via AI tool call", {
        cellId,
        contentLength: content.length,
      });

      // Update the cell source
      store.commit(
        events.cellSourceChanged({
          id: cellId,
          source: content,
          modifiedBy: `ai-assistant-${sessionId}`,
        }),
      );

      logger.info("Modified cell successfully", {
        cellId,
        contentPreview: content.slice(0, 100),
      });

      return `Modified cell ${cellId} with ${content.length} characters`;
    }

    case "execute_cell": {
      const cellId = String(args.cellId || "");

      if (!cellId) {
        logger.error("execute_cell: cellId is required");
        throw new Error("execute_cell: cellId is required");
      }

      // Check if cell exists and is executable
      const existingCell = store.query(
        tables.cells.select().where({ id: cellId }),
      )[0];

      if (!existingCell) {
        logger.error("execute_cell: Cell not found", { cellId });
        throw new Error(`execute_cell: Cell not found: ${cellId}`);
      }

      if (existingCell.cellType !== "code") {
        logger.error(
          "execute_cell: Only code cells can be executed",
          {
            cellId,
            cellType: existingCell.cellType,
          },
        );
        throw new Error(
          `execute_cell: Only code cells can be executed, got ${existingCell.cellType}`,
        );
      }

      logger.info("Executing cell via AI tool call", { cellId });

      const queueId = `exec-${Date.now()}-${
        Math.random().toString(36).slice(2)
      }`;

      // Set up execution completion monitoring with polling
      const executionCompletePromise = new Promise<string>(
        (resolve, reject) => {
          const cleanup = () => {
            if (timeout) clearTimeout(timeout);
            if (pollInterval) clearInterval(pollInterval);
          };

          const timeout = setTimeout(() => {
            cleanup();
            reject(
              new Error(
                `Execution timeout after 30 seconds for cell ${cellId}`,
              ),
            );
          }, 30000);

          // Poll execution status
          const pollInterval = setInterval(() => {
            const executionEntry = store.query(
              tables.executionQueue.select().where({ id: queueId }),
            )[0];

            if (!executionEntry) return;

            if (
              executionEntry.status === "completed" ||
              executionEntry.status === "failed"
            ) {
              cleanup();

              if (executionEntry.status === "failed") {
                reject(new Error(`Execution failed for cell ${cellId}`));
                return;
              }

              // Get cell outputs after execution
              const outputs = store.query(
                tables.outputs.select().where({ cellId }).orderBy(
                  "position",
                  "asc",
                ),
              );

              // Format outputs for AI consumption
              let outputSummary = `Cell ${cellId} executed successfully`;

              if (outputs.length > 0) {
                const outputTexts: string[] = [];

                for (const output of outputs) {
                  if (output.outputType === "terminal" && output.data) {
                    outputTexts.push(
                      `Output: ${String(output.data).trim()}`,
                    );
                  } else if (
                    output.outputType === "multimedia_result"
                  ) {
                    // Try to get text representation from representations or fallback to data
                    // Prioritize markdown for AI context, then plain text
                    let resultText = "";
                    let usedFormat = "";

                    toolLogger.debug(
                      "Processing multimedia_result for tool response",
                      {
                        cellId,
                        hasRepresentations: !!output.representations,
                        representationKeys: output.representations
                          ? Object.keys(output.representations)
                          : [],
                        hasData: !!output.data,
                      },
                    );

                    if (
                      output.representations &&
                      output.representations["text/markdown"]
                    ) {
                      const container = output.representations["text/markdown"];
                      if (container.type === "inline") {
                        resultText = String(container.data || "");
                        usedFormat = "text/markdown";
                      }
                    } else if (
                      output.representations &&
                      output.representations["text/plain"]
                    ) {
                      const container = output.representations["text/plain"];
                      if (container.type === "inline") {
                        resultText = String(container.data || "");
                        usedFormat = "text/plain";
                      }
                    } else if (output.data) {
                      resultText = String(output.data);
                      usedFormat = "raw_data";
                    }

                    toolLogger.debug("Tool result content extracted", {
                      cellId,
                      usedFormat,
                      contentLength: resultText.length,
                      fullContent: resultText,
                    });

                    if (resultText) {
                      outputTexts.push(`Result: ${resultText.trim()}`);
                    }
                  } else if (output.outputType === "error" && output.data) {
                    try {
                      const errorData = typeof output.data === "string"
                        ? JSON.parse(output.data)
                        : output.data;
                      outputTexts.push(
                        `Error: ${errorData.ename}: ${errorData.evalue}`,
                      );
                    } catch {
                      outputTexts.push(`Error: ${String(output.data)}`);
                    }
                  }
                }

                if (outputTexts.length > 0) {
                  outputSummary += `. ${outputTexts.join(". ")}`;
                }
              }

              resolve(outputSummary);
            }
          }, 500); // Poll every 500ms
        },
      );

      // Request execution for the cell
      store.commit(
        events.executionRequested({
          queueId,
          cellId,
          executionCount: (existingCell.executionCount || 0) + 1,
          requestedBy: `ai-assistant-${sessionId}`,
        }),
      );

      logger.info(
        "Execution requested for cell, waiting for completion",
        { cellId, queueId },
      );

      // Wait for execution to complete and return the result
      return await executionCompletePromise;
    }

    default:
      logger.warn("Unknown AI tool", { toolName: name });
      throw new Error(`Unknown tool: ${name}`);
  }
}

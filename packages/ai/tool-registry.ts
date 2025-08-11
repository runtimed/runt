import {
  type CellData,
  cellList$,
  createCellBetween,
  events,
  materializers,
  tables,
} from "@runt/schema";
import type { Logger } from "@runt/lib";
import type { Store } from "npm:@livestore/livestore";
import { makeSchema, State } from "npm:@livestore/livestore";
import { createLogger } from "@runt/lib";
import { getMCPClient } from "./mcp-client.ts";

// Create schema locally
const state = State.SQLite.makeState({ tables, materializers });
const schema = makeSchema({ events, state });

// Create logger for tool execution debugging
const toolLogger = createLogger("ai-tools");

export interface NotebookTool {
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
  items?: ToolParameter; // For array types
  properties?: Record<string, ToolParameter>; // For object types
  required?: string[]; // For object types
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
        source: {
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
      required: ["cellType", "source"],
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
        source: {
          type: "string",
          description: "The new content/source code for the cell",
        },
      },
      required: ["cellId", "source"],
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
  {
    name: "query_documents",
    description:
      "Search through documents that have been mounted to the runtime using the --mount flag. This uses a vector store to find relevant content based on semantic similarity to your query. The query will wait for document ingestion to complete if it's still in progress.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to find relevant documents or content",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "retrieve_document",
    description:
      "Retrieve file information for documents that match a search query using the vector store retriever. This returns the filename and mounted directory path for files that are semantically similar to your query from mounted documents.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query to find relevant document files",
        },
      },
      required: ["query"],
    },
  },
];

/**
 * Convert MCP parameter schema to ToolParameter format
 */
function convertMcpParameterToToolParameter(
  mcpParam: Record<string, unknown>,
): ToolParameter {
  const baseParam: ToolParameter = {
    type: (mcpParam.type as string) || "string",
    description: mcpParam.description as string,
    enum: mcpParam.enum as string[],
    default: mcpParam.default as string,
  };

  // Handle array types with items
  if (mcpParam.type === "array" && mcpParam.items) {
    baseParam.items = convertMcpParameterToToolParameter(
      mcpParam.items as Record<string, unknown>,
    );
  }

  // Handle object types with properties
  if (mcpParam.type === "object" && mcpParam.properties) {
    baseParam.properties = Object.fromEntries(
      Object.entries(mcpParam.properties as Record<string, unknown>).map(
        ([key, value]) => [
          key,
          convertMcpParameterToToolParameter(value as Record<string, unknown>),
        ],
      ),
    );
    baseParam.required = mcpParam.required as string[];
  }

  return baseParam;
}

/**
 * Get all available tools including both notebook tools and MCP tools
 */
export async function getAllTools(): Promise<NotebookTool[]> {
  try {
    const mcpClient = await getMCPClient();
    const mcpTools = mcpClient.getTools();

    // Convert MCP tools to notebook tool format
    const convertedMcpTools: NotebookTool[] = mcpTools.map((mcpTool) => ({
      name: mcpTool.name,
      description: mcpTool.description,
      parameters: {
        type: mcpTool.parameters.type,
        properties: Object.fromEntries(
          Object.entries(mcpTool.parameters.properties || {}).map((
            [key, value],
          ) => [
            key,
            convertMcpParameterToToolParameter(
              value as Record<string, unknown>,
            ),
          ]),
        ),
        required: mcpTool.parameters.required || [],
      },
    }));

    return [...NOTEBOOK_TOOLS, ...convertedMcpTools];
  } catch (error) {
    toolLogger.warn("Failed to get MCP tools, using only notebook tools", {
      error: String(error),
    });
    return [...NOTEBOOK_TOOLS];
  }
}

/**
 * Get only the notebook tools (for backward compatibility)
 */
export const NOTEBOOK_TOOLS_EXPORT = NOTEBOOK_TOOLS;

export function createCell(
  store: Store<typeof schema>,
  logger: Logger,
  sessionId: string,
  currentCell: CellData,
  args: Record<string, unknown>,
) {
  const cellType = String(args.cellType || "code");
  const content = String(args.source || args.content || ""); // Check source first, then content
  const position = String(args.position || "after_current");

  // Get ordered cells with fractional indices
  const cellList = store.query(cellList$);
  const currentCellIndex = cellList.findIndex((c) => c.id === currentCell.id);

  // Generate unique cell ID
  const newCellId = `cell-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let cellBefore: CellData | null = null;
  let cellAfter: CellData | null = null;

  switch (position) {
    case "before_current":
      cellBefore = currentCellIndex > 0 && cellList[currentCellIndex - 1]
        ? cellList[currentCellIndex - 1]
        : null;
      cellAfter = cellList[currentCellIndex] || null;
      break;
    case "at_end":
      cellBefore = cellList.length > 0 && cellList[cellList.length - 1]
        ? cellList[cellList.length - 1]
        : null;
      cellAfter = null;
      break;
    case "after_current":
    default:
      cellBefore = cellList[currentCellIndex] || null;
      cellAfter = currentCellIndex < cellList.length - 1 && cellList[currentCellIndex + 1]
        ? cellList[currentCellIndex + 1]
        : null;
      break;
  }

  logger.info("Creating cell via AI tool call", {
    cellType,
    placement: position,
    contentLength: content.length,
    cellBefore: cellBefore?.id,
    cellAfter: cellAfter?.id,
  });

  // Create the new cell with fractional index
  const createEvent = createCellBetween(
    {
      id: newCellId,
      cellType: cellType as "code" | "markdown" | "raw" | "sql" | "ai",
      createdBy: `ai-assistant-${sessionId}`,
    },
    cellBefore,
    cellAfter,
  );

  store.commit(createEvent);

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
  store: Store<typeof schema>,
  logger: Logger,
  sessionId: string,
  currentCell: CellData,
  toolCall: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  },
  sendWorkerMessage?: (type: string, data: unknown) => Promise<unknown>,
): Promise<string> {
  const { name, arguments: args } = toolCall;

  // Check if tool requires approval - only external tools require approval
  const isBuiltInTool = NOTEBOOK_TOOLS.some((tool) => tool.name === name);
  const requiresApproval = !isBuiltInTool;

  if (requiresApproval) {
    // Check if we already have an approval for this specific tool call
    let existingApproval = store.query(
      tables.toolApprovals.select().where({ toolCallId: toolCall.id }),
    )[0];

    // If no specific approval, check for a blanket "always" approval for this tool
    if (!existingApproval) {
      const alwaysApprovals = store.query(
        tables.toolApprovals.select().where({
          toolName: name,
          status: "approved_always",
        }),
      );

      if (alwaysApprovals.length > 0) {
        // Use the blanket approval
        existingApproval = alwaysApprovals[0];
      }
    }

    if (!existingApproval || existingApproval.status === "pending") {
      // Request approval if we don't have one
      if (!existingApproval) {
        logger.info("Requesting tool approval", {
          toolName: name,
          toolCallId: toolCall.id,
        });

        store.commit(
          events.toolApprovalRequested({
            toolCallId: toolCall.id,
            cellId: currentCell.id,
            toolName: name,
            arguments: args,
            requestedAt: new Date(),
          }),
        );
      }

      // Wait for approval with polling
      const approvalPromise = new Promise<string>((resolve, reject) => {
        const cleanup = () => {
          if (timeout) clearTimeout(timeout);
          if (pollInterval) clearInterval(pollInterval);
        };

        const timeout = setTimeout(() => {
          cleanup();
          reject(
            new Error(`Tool approval timeout after 60 seconds for ${name}`),
          );
        }, 60000); // 60 second timeout

        // Poll for approval status
        const pollInterval = setInterval(() => {
          const approval = store.query(
            tables.toolApprovals.select().where({ toolCallId: toolCall.id }),
          )[0];

          if (approval && approval.status !== "pending") {
            cleanup();

            if (approval.status === "denied") {
              reject(new Error(`Tool call denied by user: ${name}`));
              return;
            }

            if (
              approval.status === "approved_once" ||
              approval.status === "approved_always"
            ) {
              resolve("approved");
              return;
            }
          }
        }, 500); // Poll every 500ms
      });

      try {
        await approvalPromise;
      } catch (error) {
        logger.error("Tool approval failed", { toolName: name, error });
        throw error;
      }
    } else if (existingApproval.status === "denied") {
      logger.warn("Tool call denied by previous approval", { toolName: name });
      throw new Error(`Tool call denied: ${name}`);
    }

    logger.info("Tool approved, proceeding with execution", { toolName: name });
  }

  // Handle MCP tools first (with mcp__ prefix)
  if (name.startsWith("mcp__")) {
    try {
      // Transform name from mcp__<servername>__<toolname> to <servername>:<toolname>
      const transformedName = name.slice(5).replace("__", ":"); // Remove 'mcp__' prefix and replace first '__' with ':'

      logger.info("Calling MCP tool", {
        toolName: name,
        transformedName,
        args,
      });
      const mcpClient = await getMCPClient();
      const result = await mcpClient.callTool(transformedName, args);

      logger.info("MCP tool executed successfully", {
        toolName: name,
        resultLength: result.length,
      });

      return result;
    } catch (error) {
      logger.error("MCP tool execution failed", { toolName: name, error });
      throw new Error(
        `MCP tool execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Handle built-in notebook tools
  switch (name) {
    case "create_cell": {
      return createCell(store, logger, sessionId, currentCell, args);
    }

    case "modify_cell": {
      const cellId = String(args.cellId || "");
      const content = String(args.source || args.content || "");

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

    case "query_documents": {
      const query = String(args.query || "");

      if (!query) {
        logger.error("query_documents: query is required");
        throw new Error("query_documents: query is required");
      }

      logger.info("Querying vector store", {
        query,
        queryLength: query.length,
      });

      try {
        // Import vector store here to avoid circular dependencies
        const { getVectorStore } = await import("./vector-store.ts");
        const vectorStore = getVectorStore();
        
        // Check vector store status
        const status = vectorStore.getStatus();
        
        if (status.isIngesting && !status.ingestionComplete) {
          logger.info("Vector store ingestion in progress, waiting for completion");
        }
        
        // Query the vector store (will wait for ingestion if needed)
        const result = await vectorStore.query(query);
        console.log("🔍 Query result:", result);

        logger.info("Vector store query completed successfully", {
          resultLength: result.length,
        });

        return result;
      } catch (error) {
        logger.error("Vector store query failed", {
          query,
          error: String(error),
        });
        
        if (error instanceof Error && error.message.includes("not initialized")) {
          return "No documents have been mounted to search. Use the --mount flag when starting the runtime to add documents to the vector store.";
        }
        
        throw new Error(
          `Document search failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    case "retrieve_document": {
      const query = String(args.query || "");

      if (!query) {
        logger.error("retrieve_document: query is required");
        throw new Error("retrieve_document: query is required");
      }

      logger.info("Retrieving document paths from vector store", {
        query,
        queryLength: query.length,
      });

      try {
        // Import vector store here to avoid circular dependencies
        const { getVectorStore } = await import("./vector-store.ts");
        const vectorStore = getVectorStore();
        
        // Check vector store status
        const status = vectorStore.getStatus();
        
        if (status.isIngesting && !status.ingestionComplete) {
          logger.info("Vector store ingestion in progress, waiting for completion");
        }
        
        // Retrieve document information using the vector store retriever
        const fileInfos = await vectorStore.retrieveFilePaths(query);
        console.log("🔍 Retrieved file information:", fileInfos);

        logger.info("Vector store document retrieval completed successfully", {
          fileCount: fileInfos.length,
        });

        if (fileInfos.length > 0) {
          const formattedResults = fileInfos.map(info => 
            `Filename: ${info.filename}\nMounted Path: ${info.mountedPath}`
          ).join('\n\n');
          
          return `Found ${fileInfos.length} matching file(s):\n\n${formattedResults}`;
        } else {
          return "No matching documents found for the query.";
        }
      } catch (error) {
        logger.error("Vector store document retrieval failed", {
          query,
          error: String(error),
        });
        
        if (error instanceof Error && error.message.includes("not initialized")) {
          return "No documents have been mounted to search. Use the --mount flag when starting the runtime to add documents to the vector store.";
        }
        
        throw new Error(
          `Document retrieval failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    default:
      // Handle unknown tools via Python worker if available
      if (sendWorkerMessage) {
        logger.info("Calling registered Python tool via worker", {
          toolName: name,
          argsKeys: Object.keys(args),
        });

        try {
          const result = await sendWorkerMessage("run_registered_tool", {
            toolName: name,
            args: args,
          });

          logger.info("Python tool executed successfully", {
            toolName: name,
            result,
          });

          return `Tool ${name} executed successfully: ${String(result)}`;
        } catch (error) {
          logger.error("Python tool execution failed", {
            toolName: name,
            error: String(error),
          });
          throw new Error(`Failed to execute tool ${name}: ${String(error)}`);
        }
      } else {
        logger.warn("Unknown AI tool and no worker available", {
          toolName: name,
        });
        throw new Error(`Unknown tool: ${name}`);
      }
  }
}

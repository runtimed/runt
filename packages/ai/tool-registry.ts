import {
  type CellData,
  cellReferences$,
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

// Define basic notebook tools (always available)
const BASIC_NOTEBOOK_TOOLS: NotebookTool[] = [
  {
    name: "create_cell",
    description: "Create a new cell in the notebook after a specific cell. " +
      "The AI knows its own cell ID and can reference any previously created cell IDs.",
    parameters: {
      type: "object",
      properties: {
        cellType: {
          type: "string",
          enum: ["code", "markdown", "ai", "sql"],
          description:
            "The type of cell to create (defaults to 'code' if not specified)",
        },
        source: {
          type: "string",
          description: "The content/source code for the cell",
        },
        after_id: {
          type: "string",
          description: "The ID of the cell to place this new cell after. " +
            "Use your own cell ID to place cells below yourself, " +
            "or use a previously created cell's ID to build sequences.",
        },
      },
      required: ["source", "after_id"],
    },
  },
  {
    name: "modify_cell",
    description: "Modify the content of an existing cell in the notebook. " +
      "Use this to fix bugs, improve code, or update content based on user feedback. " +
      "Use the actual cell ID from the context (shown as 'ID: cell-xxx'), not position numbers.",
    parameters: {
      type: "object",
      properties: {
        cellId: {
          type: "string",
          description: "The actual cell ID from the context " +
            "(e.g., 'cell-1234567890-abc'), not a position number",
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
    description: "Execute a specific cell in the notebook. " +
      "Use this to run code after creating or modifying it, or to re-run existing cells. " +
      "Use the actual cell ID from the context (shown as 'ID: cell-xxx'), not position numbers.",
    parameters: {
      type: "object",
      properties: {
        cellId: {
          type: "string",
          description: "The actual cell ID from the context " +
            "(e.g., 'cell-1234567890-abc'), not a position number",
        },
      },
      required: ["cellId"],
    },
  },
];

// Define vector store tools (only available when indexing is enabled)
const VECTOR_STORE_TOOLS: NotebookTool[] = [
  {
    name: "query_documents",
    description:
      "Search and retrieve relevant content from mounted files based on natural language queries. " +
      "Use this tool when the user asks questions about file contents, " +
      "seeks specific information within files, or needs to understand what's in the mounted data. " +
      "This tool searches through the actual file contents and returns relevant excerpts. " +
      "IMPORTANT: Always try this tool first when the user asks about data, files, or analysis - " +
      "don't ask the user to provide files manually when this tool is available. " +
      "NOTE: If this tool returns 'ingestion in progress', continue retrying the same call until actual results are returned.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural language search query to find relevant content within files " +
            "(e.g., 'functions that handle authentication', 'sales data for Q3', 'error handling code')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "find_mounted_file",
    description:
      "Find the full file path to mounted data files based on a search query. " +
      "Use this tool when you need to write code that loads specific files, " +
      "or when you need to know the exact file paths for data analysis. " +
      "This tool returns file paths that can be used in data loading functions " +
      "like pd.read_csv(), np.loadtxt(), json.load(), or open(). " +
      "ALWAYS call this tool before writing code that loads data files to ensure you have the correct file paths. " +
      "NOTE: If this tool returns 'ingestion in progress', continue retrying the same call until actual results are returned.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query to find data files by name, type, or content " +
            "(e.g., 'CSV files', 'customer data', 'sales report', 'JSON config files', 'Python scripts')",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_indexed_files",
    description:
      "Lists all file paths that have been successfully indexed from mounted directories. " +
      "Use this tool to see what files are available for analysis when you need an overview of the mounted data. " +
      "This is helpful for understanding the scope of available data before diving into specific queries. " +
      "NOTE: If this tool returns 'ingestion in progress', continue retrying the same call until actual results are returned.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// Combined notebook tools
const NOTEBOOK_TOOLS = [...VECTOR_STORE_TOOLS, ...BASIC_NOTEBOOK_TOOLS];

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
    // Import vector store checking function to avoid circular dependencies
    const { isVectorStoreIndexingEnabled } = await import("./vector-store.ts");

    // Determine which notebook tools to include based on vector store indexing status
    const notebookTools = isVectorStoreIndexingEnabled()
      ? [...BASIC_NOTEBOOK_TOOLS, ...VECTOR_STORE_TOOLS]
      : BASIC_NOTEBOOK_TOOLS;

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

    return [...notebookTools, ...convertedMcpTools];
  } catch (error) {
    toolLogger.warn("Failed to get MCP tools, using only notebook tools", {
      error: String(error),
    });

    // Import vector store checking function to avoid circular dependencies
    try {
      const { isVectorStoreIndexingEnabled } = await import(
        "./vector-store.ts"
      );
      const notebookTools = isVectorStoreIndexingEnabled()
        ? [...BASIC_NOTEBOOK_TOOLS, ...VECTOR_STORE_TOOLS]
        : BASIC_NOTEBOOK_TOOLS;
      return [...notebookTools];
    } catch (_vectorStoreError) {
      // If we can't check vector store status, default to basic tools only
      return [...BASIC_NOTEBOOK_TOOLS];
    }
  }
}

/**
 * Get only the notebook tools (for backward compatibility)
 */
export const NOTEBOOK_TOOLS_EXPORT = NOTEBOOK_TOOLS;

/**
 * Convert escaped newlines and other common escape sequences to their actual characters
 */
function unescapeContent(content: string): string {
  return content
    .replace(/\\n/g, "\n") // Convert \n to actual newlines
    .replace(/\\t/g, "\t") // Convert \t to actual tabs
    .replace(/\\r/g, "\r") // Convert \r to actual carriage returns
    .replace(/\\\\/g, "\\"); // Convert \\ to single backslash
}

export function createCell(
  store: Store<typeof schema>,
  logger: Logger,
  sessionId: string,
  _currentCell: CellData,
  args: Record<string, unknown>,
) {
  const cellType = String(args.cellType || "code");
  const rawContent = String(args.source || args.content || ""); // Check source first, then content
  const content = unescapeContent(rawContent); // Process escaped characters
  const afterId = String(args.after_id); // Now required

  // Get ordered cells with fractional indices
  const cellList = store.query(cellReferences$);

  // Find the cell to insert after
  const afterCellIndex = cellList.findIndex((c) => c.id === afterId);
  if (afterCellIndex === -1) {
    throw new Error(`Cell with ID ${afterId} not found`);
  }

  // Generate unique cell ID
  const newCellId = `cell-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const cellBefore = cellList[afterCellIndex]!; // Safe because we checked afterCellIndex !== -1
  const cellAfter = afterCellIndex < cellList.length - 1
    ? cellList[afterCellIndex + 1] || null
    : null;

  logger.info("Creating cell via AI tool call", {
    cellType,
    afterId,
    contentLength: content.length,
    cellBefore: cellBefore?.id,
    cellAfter: cellAfter?.id,
  });

  // Create the new cell with fractional index
  const createResult = createCellBetween(
    {
      id: newCellId,
      cellType: cellType as "code" | "markdown" | "raw" | "sql" | "ai",
      createdBy: `ai-assistant-${sessionId}`,
    },
    cellBefore,
    cellAfter,
    cellList,
  );

  // Commit all events (may include rebalancing)
  createResult.events.forEach((event) => store.commit(event));

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

  // Validate tool parameters against schema
  try {
    // Get all available tools to find the definition
    const allTools = await getAllTools();
    const toolDef = allTools.find((tool) => tool.name === name);

    if (toolDef && toolDef.parameters?.required) {
      const missingParams = toolDef.parameters.required.filter(
        (param: string) => !(param in args),
      );

      if (missingParams.length > 0) {
        const errorMessage = `Missing required parameters: ${
          missingParams.join(", ")
        }`;
        logger.error("Tool call validation failed", {
          toolName: name,
          missingParams,
          providedArgs: Object.keys(args),
        });
        throw new Error(errorMessage);
      }
    }
  } catch (error) {
    // If validation fails, log and re-throw
    if (
      error instanceof Error &&
      error.message.includes("Missing required parameters")
    ) {
      throw error;
    }
    logger.warn("Could not validate tool parameters", {
      toolName: name,
      error: error instanceof Error ? error.message : String(error),
    });
  }

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
      const rawContent = String(args.source || args.content || "");
      const content = unescapeContent(rawContent); // Process escaped characters

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

      // Check if vector store indexing is enabled first
      const { isVectorStoreIndexingEnabled } = await import(
        "./vector-store.ts"
      );
      if (!isVectorStoreIndexingEnabled()) {
        return "Vector store indexing is disabled. To search mounted files, restart the runtime with the --index-mounted-files flag.";
      }

      logger.info("Querying vector store", {
        query,
        queryLength: query.length,
      });

      try {
        // Import vector store here to avoid circular dependencies
        const { getVectorStore } = await import("./vector-store.ts");
        const vectorStore = getVectorStore();

        // Query the vector store (simplified - internal method handles ingestion state)
        const result = await vectorStore.query(query);

        logger.info("Vector store query completed successfully", {
          resultLength: result.length,
        });

        return result;
      } catch (error) {
        logger.error("Vector store query failed", {
          query,
          error: String(error),
        });

        if (
          error instanceof Error && error.message.includes("not initialized")
        ) {
          return "No documents have been mounted to search. Use the --mount flag when starting the runtime to add documents to the vector store.";
        }

        throw new Error(
          `Document search failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    case "find_mounted_file": {
      const query = String(args.query || "");

      if (!query) {
        logger.error("find_mounted_file: query is required");
        throw new Error("find_mounted_file: query is required");
      }

      // Check if vector store indexing is enabled first
      const { isVectorStoreIndexingEnabled } = await import(
        "./vector-store.ts"
      );
      if (!isVectorStoreIndexingEnabled()) {
        return "Vector store indexing is disabled. To search mounted files, restart the runtime with the --index-mounted-files flag.";
      }

      logger.info("Finding mounted file paths", {
        query,
        queryLength: query.length,
      });

      try {
        // Import vector store here to avoid circular dependencies
        const { getVectorStore } = await import("./vector-store.ts");
        const vectorStore = getVectorStore();

        // Retrieve file paths using the vector store (simplified - internal method handles ingestion state)
        const response = await vectorStore.retrieveFilePaths(query);

        logger.info("File path retrieval completed successfully");

        return response;
      } catch (error) {
        logger.error("File path retrieval failed", {
          query,
          error: String(error),
        });

        if (
          error instanceof Error && error.message.includes("not initialized")
        ) {
          return "No files have been mounted to search. Use the --mount flag when starting the runtime to add files to the vector store.";
        }

        throw new Error(
          `File path search failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    case "list_indexed_files": {
      // Check if vector store indexing is enabled first
      const { isVectorStoreIndexingEnabled } = await import(
        "./vector-store.ts"
      );
      if (!isVectorStoreIndexingEnabled()) {
        return "Vector store indexing is disabled. To search mounted files, restart the runtime with the --index-mounted-files flag.";
      }

      logger.info("Listing all indexed file paths");

      try {
        // Import vector store here to avoid circular dependencies
        const { getVectorStore } = await import("./vector-store.ts");
        const vectorStore = getVectorStore();

        // Get all indexed file paths (simplified - internal method handles ingestion state)
        const response = vectorStore.getAllIndexedFilePaths();

        logger.info("Retrieved all indexed file paths successfully");

        return response;
      } catch (error) {
        logger.error("Failed to list indexed files", {
          error: String(error),
        });

        if (
          error instanceof Error && error.message.includes("not initialized")
        ) {
          return "No files have been mounted and indexed. Use the --mount flag when starting the runtime to add files to the vector store.";
        }

        throw new Error(
          `Failed to list indexed files: ${
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

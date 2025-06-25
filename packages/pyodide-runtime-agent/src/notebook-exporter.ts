// Notebook Export Utility
//
// This module provides functionality to export LiveStore notebook data
// to standard Jupyter notebook (.ipynb) format for compatibility and sharing.

import type { Store } from "npm:@livestore/livestore";
import { type CellData, type OutputData, schema, tables } from "@runt/schema";
import { createLogger } from "@runt/lib";

const logger = createLogger("notebook-exporter");

/**
 * Jupyter notebook JSON schema for validation
 * Based on nbformat v4.5 schema
 */

/**
 * Jupyter notebook cell structure
 */
interface JupyterCell {
  cell_type: "code" | "markdown" | "raw";
  metadata: Record<string, unknown>;
  source: string[];
  id?: string;
  execution_count?: number | null;
  outputs?: JupyterOutput[];
}

/**
 * Jupyter notebook output structure
 */
interface JupyterOutput {
  output_type: "execute_result" | "display_data" | "stream" | "error";
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  name?: "stdout" | "stderr";
  text?: string | string[];
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

/**
 * Complete Jupyter notebook structure
 */
interface JupyterNotebook {
  nbformat: 4;
  nbformat_minor: 4;
  metadata: {
    kernelspec: {
      display_name: string;
      language: string;
      name: string;
    };
    language_info: {
      name: string;
      version: string;
    };
    runt?: {
      notebook_id: string;
      exported_at: string;
      kernel_type: string;
    };
  };
  cells: JupyterCell[];
}

/**
 * Export configuration options
 */
export interface ExportOptions {
  /** Include AI cells as Python cells with chat() wrapper */
  includeAiCells?: boolean;
  /** Include SQL cells as Python cells with sql() wrapper */
  includeSqlCells?: boolean;
  /** Transform cell sources for compatibility */
  transformSources?: boolean;
}

/**
 * Converts LiveStore notebook data to Jupyter notebook format
 */
export class NotebookExporter {
  private store: Store<typeof schema>;
  private notebookId: string;

  constructor(store: Store<typeof schema>, notebookId: string) {
    this.store = store;
    this.notebookId = notebookId;
  }

  /**
   * Export the notebook to .ipynb format
   */
  exportNotebook(options: ExportOptions = {}): JupyterNotebook {
    const {
      includeAiCells = true,
      includeSqlCells = true,
      transformSources = true,
    } = options;

    // Get notebook metadata
    const notebook = this.store.query(
      tables.notebook.select().where({ id: this.notebookId }),
    )[0];

    if (!notebook) {
      throw new Error(`Notebook ${this.notebookId} not found`);
    }

    // Get all cells ordered by position
    const cells = this.store.query(
      tables.cells.select().orderBy("position", "asc"),
    ) as CellData[];

    const jupyterCells: JupyterCell[] = [];

    for (const cell of cells) {
      // Skip cells based on options
      if (!includeAiCells && cell.cellType === "ai") continue;
      if (!includeSqlCells && cell.cellType === "sql") continue;

      const jupyterCell = this.convertCell(cell, transformSources);
      if (jupyterCell) {
        jupyterCells.push(jupyterCell);
      }
    }

    // Get the active kernel type from kernel sessions
    const activeKernelSessions = this.store.query(
      tables.kernelSessions.select().where({ isActive: true }),
    );
    const kernelType = activeKernelSessions.length > 0
      ? activeKernelSessions[0]!.kernelType
      : notebook.kernelType;

    const notebookData = {
      nbformat: 4 as const,
      nbformat_minor: 4 as const,
      metadata: {
        kernelspec: {
          display_name: this.getKernelDisplayName(kernelType),
          language: this.getKernelLanguage(kernelType),
          name: kernelType,
        },
        language_info: {
          name: this.getKernelLanguage(kernelType),
          version: "3.11", // Default Python version for Pyodide
        },
        runt: {
          notebook_id: this.notebookId,
          exported_at: new Date().toISOString(),
          kernel_type: kernelType,
          sync_url: this.getSyncUrl(),
        },
      },
      cells: jupyterCells,
    };

    // Validate the notebook against Jupyter schema
    try {
      this.validateNotebook(notebookData);
      logger.debug("Notebook passed schema validation", {
        notebookId: this.notebookId,
      });
    } catch (error) {
      logger.warn("Notebook failed schema validation", {
        error: error instanceof Error ? error.message : String(error),
        notebookId: this.notebookId,
      });
    }

    return notebookData;
  }

  /**
   * Convert a LiveStore cell to Jupyter cell format
   */
  private convertCell(
    cell: CellData,
    transformSources: boolean,
  ): JupyterCell | null {
    const baseCell = {
      id: cell.id,
      metadata: {
        runt: {
          cell_type: cell.cellType,
          execution_state: cell.executionState,
          created_by: cell.createdBy,
        },
      },
    };

    // Convert source to array of lines with proper newlines
    const sourceLines = this.formatSourceLines(cell.source);

    switch (cell.cellType) {
      case "code": {
        const codeCell: JupyterCell = {
          ...baseCell,
          cell_type: "code",
          source: sourceLines,
          execution_count: cell.executionCount,
          outputs: this.convertOutputs(cell.id),
        };
        return codeCell;
      }

      case "markdown": {
        const markdownCell: JupyterCell = {
          ...baseCell,
          cell_type: "markdown",
          source: sourceLines,
        };
        return markdownCell;
      }

      case "raw": {
        const rawCell: JupyterCell = {
          ...baseCell,
          cell_type: "raw",
          source: sourceLines,
        };
        return rawCell;
      }

      case "ai": {
        if (!transformSources) {
          // Return as markdown cell with AI marker
          return {
            ...baseCell,
            cell_type: "markdown",
            source: [`**AI Cell:**\n`, ...sourceLines],
            metadata: {
              ...baseCell.metadata,
              tags: ["ai-cell"],
            },
          };
        }

        // Check if cell is empty - if so, keep as empty code cell
        logger.debug("Processing AI cell", {
          cellId: cell.id,
          sourceLength: cell.source.length,
          sourceTrimmed: cell.source.trim().length,
          isEmpty: !cell.source.trim(),
        });

        if (!cell.source.trim()) {
          logger.debug("AI cell is empty, keeping as empty code cell", {
            cellId: cell.id,
          });
          return {
            ...baseCell,
            cell_type: "code",
            source: [""],
            execution_count: cell.executionCount,
            outputs: this.convertOutputs(cell.id),
          };
        }

        // Transform to Python code cell with chat() wrapper
        const escapedSource = cell.source.replace(/"""/g, '\\"\\"\\"');
        const wrappedSource = `chat("""${escapedSource}""")`;

        logger.debug("Transforming AI cell to chat() wrapper", {
          cellId: cell.id,
          originalSource: cell.source,
          wrappedSource: wrappedSource,
        });

        const aiCell: JupyterCell = {
          ...baseCell,
          cell_type: "code",
          source: [wrappedSource],
          execution_count: cell.executionCount,
          outputs: this.convertOutputs(cell.id),
        };
        return aiCell;
      }

      case "sql": {
        if (!transformSources) {
          // Return as markdown cell with SQL marker
          return {
            ...baseCell,
            cell_type: "markdown",
            source: [`**SQL Cell:**\n\`\`\`sql\n`, ...sourceLines, `\n\`\`\``],
            metadata: {
              ...baseCell.metadata,
              tags: ["sql-cell"],
            },
          };
        }

        // Check if cell is empty - if so, keep as empty code cell
        if (!cell.source.trim()) {
          return {
            ...baseCell,
            cell_type: "code",
            source: [""],
            execution_count: cell.executionCount,
            outputs: this.convertOutputs(cell.id),
          };
        }

        // Transform to Python code cell with sql() wrapper
        const escapedSource = cell.source.replace(/"""/g, '\\"\\"\\"');
        const wrappedSource = `sql("""${escapedSource}""")`;

        const sqlCell: JupyterCell = {
          ...baseCell,
          cell_type: "code",
          source: [wrappedSource],
          execution_count: cell.executionCount,
          outputs: this.convertOutputs(cell.id),
        };
        return sqlCell;
      }

      default:
        logger.warn(`Unknown cell type: ${cell.cellType}`);
        return null;
    }
  }

  /**
   * Convert LiveStore outputs to Jupyter outputs
   */
  private convertOutputs(cellId: string): JupyterOutput[] {
    const outputs = this.store.query(
      tables.outputs
        .select()
        .where({ cellId })
        .orderBy("position", "asc"),
    ) as OutputData[];

    return outputs.map((output): JupyterOutput => {
      switch (output.outputType) {
        case "execute_result":
        case "display_data": {
          const result = {
            output_type: output.outputType,
            data: output.data as Record<string, unknown>,
            metadata: output.metadata || {},
          } as JupyterOutput;

          if (output.outputType === "execute_result") {
            result.execution_count = this.getExecutionCount(cellId);
          }

          return result;
        }

        case "stream": {
          const streamData = output.data as { name: string; text: string };
          return {
            output_type: "stream",
            name: streamData.name as "stdout" | "stderr",
            text: streamData.text.split("\n"),
          };
        }

        case "error": {
          const errorData = output.data as {
            ename: string;
            evalue: string;
            traceback?: string[];
          };
          return {
            output_type: "error",
            ename: errorData.ename,
            evalue: errorData.evalue,
            traceback: errorData.traceback || [],
          };
        }

        default:
          logger.warn(`Unknown output type: ${output.outputType}`);
          return {
            output_type: "display_data",
            data: { "text/plain": String(output.data) },
            metadata: {},
          };
      }
    });
  }

  /**
   * Get execution count for a cell
   */
  private getExecutionCount(cellId: string): number | null {
    const cell = this.store.query(
      tables.cells.select().where({ id: cellId }),
    )[0] as CellData;

    return cell?.executionCount || null;
  }

  /**
   * Get kernel display name from kernel type
   */
  private getKernelDisplayName(kernelType: string): string {
    switch (kernelType) {
      case "python3-pyodide":
        return "Python 3 (Pyodide)";
      case "python3":
        return "Python 3";
      default:
        return kernelType;
    }
  }

  /**
   * Get kernel language from kernel type
   */
  private getKernelLanguage(kernelType: string): string {
    if (kernelType.startsWith("python")) {
      return "python";
    }
    return "python"; // Default to python for now
  }

  /**
   * Write notebook to file
   */
  async writeToFile(
    filePath: string,
    options: ExportOptions = {},
  ): Promise<void> {
    try {
      logger.debug("Starting notebook export process", {
        filePath,
        options,
        notebookId: this.notebookId,
      });

      const notebook = this.exportNotebook(options);

      logger.debug("Notebook structure created", {
        cellCount: notebook.cells.length,
        notebookId: this.notebookId,
        kernelType: notebook.metadata.kernelspec.name,
      });

      const content = JSON.stringify(notebook, null, 2);

      logger.debug("JSON content generated", {
        contentLength: content.length,
        filePath,
        notebookId: this.notebookId,
      });

      await Deno.writeTextFile(filePath, content);

      logger.info("Notebook exported successfully", {
        filePath,
        cellCount: notebook.cells.length,
        notebookId: this.notebookId,
      });
    } catch (error) {
      logger.error("Failed to write notebook file", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        notebookId: this.notebookId,
      });
      console.error("Raw writeToFile error:", error);
      throw error;
    }
  }

  /**
   * Generate a filename based on notebook metadata
   */
  generateFilename(): string {
    try {
      logger.debug("Generating filename", {
        notebookId: this.notebookId,
      });

      const notebook = this.store.query(
        tables.notebook.select().where({ id: this.notebookId }),
      )[0];

      logger.debug("Notebook query result for filename", {
        notebookFound: !!notebook,
        notebookTitle: notebook?.title,
        notebookId: this.notebookId,
      });

      if (!notebook) {
        // Use storeId (notebookId) as the filename since it's the actual identifier
        const filename = `${this.notebookId}.ipynb`;
        logger.debug("No notebook found, using storeId", { filename });
        return filename;
      }

      // Sanitize title for filename
      const sanitizedTitle = notebook.title
        .replace(/[^a-zA-Z0-9\-_\s]/g, "")
        .replace(/\s+/g, "-")
        .toLowerCase();

      logger.debug("Title sanitization", {
        originalTitle: notebook.title,
        sanitizedTitle: sanitizedTitle,
      });

      const filename = sanitizedTitle && sanitizedTitle !== "untitled-notebook"
        ? `${sanitizedTitle}.ipynb`
        : `${this.notebookId}.ipynb`;

      logger.debug("Final filename decision", { filename });
      return filename;
    } catch (error) {
      // Fallback if store query fails - use storeId
      logger.debug("Failed to query notebook for filename, using storeId", {
        notebookId: this.notebookId,
        error: error instanceof Error ? error.message : String(error),
      });
      return `${this.notebookId}.ipynb`;
    }
  }

  /**
   * Format source code into proper Jupyter notebook format
   * Each line should end with \n except the last line
   */
  private formatSourceLines(source: string): string[] {
    if (!source) return [""];

    const lines = source.split("\n");
    return lines.map((line, index) => {
      // Add newline to all lines except the last one
      return index < lines.length - 1 ? line + "\n" : line;
    });
  }

  /**
   * Get sync URL from environment or return empty string
   */
  private getSyncUrl(): string {
    try {
      return Deno.env.get("LIVESTORE_SYNC_URL") || "";
    } catch {
      return "";
    }
  }

  /**
   * Validate notebook against Jupyter schema
   */
  private validateNotebook(notebook: JupyterNotebook): void {
    // Basic validation - ensure required fields exist
    if (!notebook.nbformat || notebook.nbformat !== 4) {
      throw new Error("Invalid nbformat: must be 4");
    }

    if (!notebook.nbformat_minor || notebook.nbformat_minor < 4) {
      throw new Error("Invalid nbformat_minor: must be >= 4");
    }

    if (!notebook.metadata?.kernelspec?.name) {
      throw new Error("Missing required kernelspec.name in metadata");
    }

    if (!notebook.metadata?.kernelspec?.display_name) {
      throw new Error("Missing required kernelspec.display_name in metadata");
    }

    if (!notebook.metadata?.language_info?.name) {
      throw new Error("Missing required language_info.name in metadata");
    }

    if (!Array.isArray(notebook.cells)) {
      throw new Error("Cells must be an array");
    }

    // Validate each cell
    for (const [index, cell] of notebook.cells.entries()) {
      this.validateCell(cell, index);
    }

    logger.debug("Notebook validation passed", {
      cellCount: notebook.cells.length,
      notebookId: this.notebookId,
    });
  }

  /**
   * Validate individual cell structure
   */
  private validateCell(cell: JupyterCell, index: number): void {
    if (!cell.id) {
      throw new Error(`Cell ${index}: missing required id`);
    }

    if (!["code", "markdown", "raw"].includes(cell.cell_type)) {
      throw new Error(`Cell ${index}: invalid cell_type ${cell.cell_type}`);
    }

    if (!cell.metadata) {
      throw new Error(`Cell ${index}: missing required metadata`);
    }

    if (!Array.isArray(cell.source)) {
      throw new Error(`Cell ${index}: source must be an array of strings`);
    }

    // Validate code cell specific requirements
    if (cell.cell_type === "code") {
      if (!("execution_count" in cell)) {
        throw new Error(`Cell ${index}: code cells must have execution_count`);
      }

      if (!("outputs" in cell) || !Array.isArray(cell.outputs)) {
        throw new Error(`Cell ${index}: code cells must have outputs array`);
      }
    }
  }
}

/**
 * Utility function to create and export a notebook
 */
export async function exportNotebook(
  store: Store<typeof schema>,
  notebookId: string,
  filePath?: string,
  options: ExportOptions = {},
): Promise<string> {
  const exporter = new NotebookExporter(store, notebookId);

  const outputPath = filePath || exporter.generateFilename();
  await exporter.writeToFile(outputPath, options);

  return outputPath;
}

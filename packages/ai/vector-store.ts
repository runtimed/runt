import {
  Settings,
  VectorStoreIndex,
  Document,
} from "llamaindex";
import { OpenAIEmbedding } from "@llamaindex/openai";
import { createLogger } from "@runt/lib";
import type { Logger } from "@runt/lib";

// Initialize logger for vector store operations
const vectorLogger = createLogger("vector-store");

// Global flag to prevent multiple embedding model configuration
let embeddingConfigured = false;

/**
 * Vector store service for managing document ingestion and querying
 */
export class VectorStoreService {
  private queryEngine: any | null = null;
  private isIngesting = false;
  private ingestionComplete = false;
  private ingestionPromise: Promise<void> | null = null;
  private logger: Logger;

  constructor() {
    this.logger = vectorLogger;
    this.configureEmbeddingModel();
  }

  /**
   * Configure the embedding model based on available API keys and environment
   */
  private configureEmbeddingModel(): void {
    // Only configure embeddings once globally to prevent "already imported" issues
    if (embeddingConfigured) {
      this.logger.debug("Embedding model already configured, skipping");
      return;
    }

    try {
      // Use OpenAI embeddings if API key is available
      const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
      
      if (openaiApiKey) {
        this.logger.info("Configuring OpenAI embeddings for vector store");
        Settings.embedModel = new OpenAIEmbedding({
          model: "text-embedding-3-small", // Faster and cheaper than text-embedding-3-large
          apiKey: openaiApiKey,
        });
        this.logger.info("OpenAI embeddings configured successfully");
        embeddingConfigured = true;
        return;
      }

      // No OpenAI API key available
      this.logger.warn("No OpenAI API key found. Vector store will use default embeddings, but performance may be limited.");
      this.logger.info("To use optimal embeddings, set OPENAI_API_KEY environment variable");
      embeddingConfigured = true;
      
    } catch (error) {
      this.logger.error("Failed to configure embedding model", { error: String(error) });
      this.logger.warn("Using default embedding model as fallback");
      embeddingConfigured = true;
    }
  }

  /**
   * Start asynchronous ingestion of files from mount data
   */
  async startIngestion(
    mountData: Array<{ hostPath: string; files: Array<{ path: string; content: Uint8Array }> }>,
  ): Promise<void> {
    if (this.isIngesting || this.ingestionComplete) {
      this.logger.warn("Ingestion already started or completed");
      return;
    }

    this.isIngesting = true;
    this.logger.info("Starting vector store ingestion...");

    this.ingestionPromise = this.performIngestion(mountData);
    
    // Start ingestion asynchronously - don't await here to avoid blocking startup
    this.ingestionPromise
      .then(() => {
        this.ingestionComplete = true;
        this.isIngesting = false;
        this.logger.info("Vector store ingestion completed successfully");
      })
      .catch((error) => {
        this.isIngesting = false;
        this.logger.error("Vector store ingestion failed", { error: String(error) });
      });
  }

  /**
   * Perform the actual file ingestion
   */
  private async performIngestion(
    mountData: Array<{ hostPath: string; files: Array<{ path: string; content: Uint8Array }> }>,
  ): Promise<void> {
    const documents: Document[] = [];
    let totalFiles = 0;
    let ingestedFiles = 0;
    let skippedFiles = 0;

    for (const { hostPath, files } of mountData) {
      this.logger.info(`Processing mount path: ${hostPath}`);
      
      for (const { path, content } of files) {
        totalFiles++;
        
        // Skip .git directories and hidden files
        if (this.shouldSkipFile(path)) {
          skippedFiles++;
          this.logger.debug(`Skipping file: ${path} (filtered)`);
          continue;
        }

        // Skip large files (> 50MB)
        if (content.length > 50 * 1024 * 1024) {
          skippedFiles++;
          this.logger.debug(`Skipping file: ${path} (size: ${content.length} bytes > 50MB)`);
          continue;
        }

        try {
          // Convert Uint8Array to string
          const textContent = new TextDecoder().decode(content);
          
          // Only process files that appear to be text-based
          if (this.isTextFile(textContent)) {
            const document = new Document({
              text: textContent,
              metadata: {
                path,
                hostPath,
                size: content.length,
              },
            });
            
            documents.push(document);
            ingestedFiles++;
            this.logger.debug(`Prepared for ingestion: ${path}`);
          } else {
            skippedFiles++;
            this.logger.debug(`Skipping non-text file: ${path}`);
          }
        } catch (error) {
          skippedFiles++;
          this.logger.warn(`Failed to process file: ${path}`, { error: String(error) });
        }
      }
    }

    this.logger.info(
      `File processing complete. Total: ${totalFiles}, Ingested: ${ingestedFiles}, Skipped: ${skippedFiles}`,
    );

    if (documents.length > 0) {
      const embeddingModel = this.getEmbeddingModelInfo();
      this.logger.info(`Creating vector index from ${documents.length} documents using ${embeddingModel} embeddings...`);
      
      // Create the vector index from documents (uses default in-memory vector store)
      const index = await VectorStoreIndex.fromDocuments(documents);
      
      // Create query engine
      this.queryEngine = index.asQueryEngine();
      
      this.logger.info(`Vector index created successfully with ${documents.length} documents`);
    } else {
      this.logger.warn("No documents to ingest");
    }
  }

  /**
   * Check if a file should be skipped based on its path
   */
  private shouldSkipFile(path: string): boolean {
    const skipPatterns = [
      /\/\.git\//,
      /\/node_modules\//,
      /\/\.vscode\//,
      /\/\.idea\//,
      /\/__pycache__\//,
      /\/\.pytest_cache\//,
      /\/\.coverage/,
      /\/\.DS_Store$/,
      /\.pyc$/,
      /\.pyo$/,
      /\.egg-info\//,
      /\/build\//,
      /\/dist\//,
      /\/target\//,
    ];

    return skipPatterns.some(pattern => pattern.test(path));
  }

  /**
   * Check if content appears to be text-based
   */
  private isTextFile(content: string): boolean {
    // Check for null bytes which indicate binary files
    if (content.includes('\0')) {
      return false;
    }

    // Check for reasonable ratio of printable characters
    const printableCount = content.split('').filter(char => {
      const code = char.charCodeAt(0);
      return code >= 32 && code <= 126 || code === 9 || code === 10 || code === 13;
    }).length;

    const ratio = printableCount / content.length;
    return ratio > 0.7; // At least 70% printable characters
  }

  /**
   * Query the vector store
   */
  async query(queryText: string): Promise<string> {
    // Check if ingestion is still in progress
    if (this.isIngesting && !this.ingestionComplete) {
      this.logger.info("Query requested while ingestion in progress, waiting for completion...");
      
      if (this.ingestionPromise) {
        await this.ingestionPromise;
      }
    }

    if (!this.queryEngine) {
      throw new Error("Vector store not initialized or no documents ingested");
    }

    this.logger.info(`Executing query: "${queryText}"`);
    
    try {
      const response = await this.queryEngine.query({ query: queryText });
      const result = response.toString();
      
      this.logger.info(`Query completed successfully`);
      return result;
    } catch (error) {
      this.logger.error("Query execution failed", { error: String(error) });
      throw new Error(`Query failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get the current status of the vector store
   */
  getStatus(): {
    isIngesting: boolean;
    ingestionComplete: boolean;
    isReady: boolean;
    embeddingModel?: string;
  } {
    const embeddingModel = this.getEmbeddingModelInfo();
    return {
      isIngesting: this.isIngesting,
      ingestionComplete: this.ingestionComplete,
      isReady: this.ingestionComplete && this.queryEngine !== null,
      embeddingModel,
    };
  }

  /**
   * Get information about the configured embedding model
   */
  private getEmbeddingModelInfo(): string {
    try {
      if (Settings.embedModel) {
        // Try to extract model information
        const modelInfo = Settings.embedModel.constructor.name;
        if (modelInfo.includes("OpenAI")) {
          return "OpenAI (text-embedding-3-small)";
        }
        return modelInfo;
      }
      return "Default";
    } catch {
      return "Unknown";
    }
  }

  /**
   * Reset the vector store (for testing or reinitialization)
   */
  reset(): void {
    this.queryEngine = null;
    this.isIngesting = false;
    this.ingestionComplete = false;
    this.ingestionPromise = null;
    embeddingConfigured = false; // Allow reconfiguration after reset
    this.logger.info("Vector store reset");
  }
}

// Global singleton instance
let vectorStoreInstance: VectorStoreService | null = null;

/**
 * Get the singleton vector store instance
 */
export function getVectorStore(): VectorStoreService {
  if (!vectorStoreInstance) {
    vectorStoreInstance = new VectorStoreService();
  }
  return vectorStoreInstance;
}

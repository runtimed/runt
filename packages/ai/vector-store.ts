import {
  Settings,
  VectorStoreIndex,
  Document,
} from "llamaindex";
import { OpenAIEmbedding, OpenAI } from "@llamaindex/openai";
import { SimpleDirectoryReader } from "@llamaindex/readers/directory";
import { TextFileReader } from "@llamaindex/readers/text";
import { createLogger } from "@runt/lib";
import type { Logger } from "@runt/lib";
import { join, dirname } from "@std/path";

// Initialize logger for vector store operations
const vectorLogger = createLogger("vector-store");

// Global flag to prevent multiple embedding model configuration
let embeddingConfigured = false;

/**
 * Vector store service for managing document ingestion and querying
 */
export class VectorStoreService {
  private retriever: any | null = null;
  private queryEngine: any | null = null;
  private isIngesting = false;
  private ingestionComplete = false;
  private ingestionPromise: Promise<void> | null = null;
  private logger: Logger;

  constructor() {
    console.log("🏗️  Creating VectorStoreService instance...");
    this.logger = vectorLogger;
    
    try {
      this.configureModel();
      console.log("✅ VectorStoreService created successfully");
    } catch (error) {
      console.error("❌ Failed to create VectorStoreService:", error);
      throw error;
    }
  }

  /**
   * Configure the embedding model based on available API keys and environment
   */
  private configureModel(): void {
    // Only configure embeddings once globally to prevent "already imported" issues
    if (embeddingConfigured) {
      console.log("🔧 Embedding model already configured, skipping");
      this.logger.debug("Embedding model already configured, skipping");
      return;
    }

    console.log("🔧 Configuring embedding model...");

    try {
      // Use OpenAI embeddings if API key is available
      const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
      
      if (openaiApiKey) {
        console.log("🔑 OpenAI API key found, configuring OpenAI embeddings...");
        this.logger.info("Configuring OpenAI embeddings for vector store");
        
        try {
          Settings.embedModel = new OpenAIEmbedding({
            model: "text-embedding-3-large", // Faster and cheaper than text-embedding-3-large
            apiKey: openaiApiKey,
          })
          Settings.llm = new OpenAI({
            model: "gpt-4o",
            apiKey: openaiApiKey,
          });
          console.log("✅ OpenAI embeddings configured successfully");
          this.logger.info("OpenAI embeddings configured successfully");
          embeddingConfigured = true;
          return;
        } catch (openaiError) {
          console.error("❌ Failed to configure OpenAI embeddings:", openaiError);
          throw openaiError;
        }
      }

      // No OpenAI API key available
      console.log("⚠️  No OpenAI API key found, using default embeddings");
      this.logger.warn("No OpenAI API key found. Vector store will use default embeddings, but performance may be limited.");
      this.logger.info("To use optimal embeddings, set OPENAI_API_KEY environment variable");
      embeddingConfigured = true;
      
    } catch (error) {
      console.error("❌ Failed to configure embedding model:", error);
      this.logger.error("Failed to configure embedding model", { error: String(error) });
      this.logger.warn("Using default embedding model as fallback");
      embeddingConfigured = true;
      throw error; // Re-throw to surface the actual error
    }
  }

  /**
   * Start asynchronous ingestion of files from mount data
   */
  async startIngestion(
    mountData: Array<{ hostPath: string; targetPath?: string; files: Array<{ path: string; content: Uint8Array }> }>,
  ): Promise<void> {
    if (this.isIngesting || this.ingestionComplete) {
      this.logger.warn("Ingestion already started or completed");
      return;
    }

    this.isIngesting = true;
    this.logger.info(`Starting vector store ingestion with ${mountData.length} mount paths...`);
    
    // Log mount data details
    for (const { hostPath, files } of mountData) {
      this.logger.info(`Mount path: ${hostPath} contains ${files.length} files`);
    }

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
        this.logger.error("Vector store ingestion failed", { 
          error: String(error),
          stack: error instanceof Error ? error.stack : undefined,
          mountDataLength: mountData.length,
          totalFiles: mountData.reduce((sum, mount) => sum + mount.files.length, 0)
        });
        
        // Also log to console for immediate visibility
        console.error("❌ Vector store ingestion failed:", error);
        if (error instanceof Error && error.stack) {
          console.error("Stack trace:", error.stack);
        }
      });
  }

  /**
   * Perform the actual file ingestion using SimpleDirectoryReader
   */
  private async performIngestion(
    mountData: Array<{ hostPath: string; targetPath?: string; files: Array<{ path: string; content: Uint8Array }> }>,
  ): Promise<void> {
    console.log("🔄 Starting performIngestion with SimpleDirectoryReader...");
    
    let totalFiles = 0;
    let ingestedFiles = 0;
    let skippedFiles = 0;
    let tempDir: string | null = null;

    try {
      console.log(`📁 Processing ${mountData.length} mount paths...`);
      
      // Create temporary directory for file processing
      tempDir = await Deno.makeTempDir({ prefix: "runt_vector_ingestion_" });
      console.log(`📁 Created temporary directory: ${tempDir}`);
      
      // Write all files to temporary directory maintaining structure
      for (const { hostPath, files } of mountData) {
        console.log(`📂 Processing mount path: ${hostPath} with ${files.length} files`);
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
            console.log(`⚠️  Skipping large file: ${path} (${content.length} bytes)`);
            continue;
          }

          try {
            // Create the full file path in temp directory
            const tempFilePath = join(tempDir, path);
            const tempFileDir = dirname(tempFilePath);
            
            // Ensure directory exists
            await Deno.mkdir(tempFileDir, { recursive: true });
            
            // Write file content
            await Deno.writeFile(tempFilePath, content);
            ingestedFiles++;
            
            this.logger.debug(`Written to temp: ${tempFilePath}`);
            
            // Log every 20th file for progress tracking
            if (ingestedFiles % 20 === 0) {
              console.log(`📄 Written ${ingestedFiles} files to temp directory...`);
            }
          } catch (error) {
            skippedFiles++;
            console.error(`❌ Failed to write file: ${path}`, error);
            this.logger.warn(`Failed to write file: ${path}`, { error: String(error) });
          }
        }
      }

      console.log(`📊 File writing complete. Total: ${totalFiles}, Written: ${ingestedFiles}, Skipped: ${skippedFiles}`);
      this.logger.info(
        `File writing complete. Total: ${totalFiles}, Written: ${ingestedFiles}, Skipped: ${skippedFiles}`,
      );

      if (ingestedFiles > 0) {
        const embeddingModel = this.getEmbeddingModelInfo();
        console.log(`🚀 Loading documents from temp directory using SimpleDirectoryReader with ${embeddingModel} embeddings...`);
        this.logger.info(`Loading documents from temp directory using SimpleDirectoryReader`);
        
        try {
          // Create SimpleDirectoryReader with TextFileReader as default
          const reader = new SimpleDirectoryReader();
          console.log("📦 Loading documents with SimpleDirectoryReader...");
          
          const documents = await reader.loadData({
            directoryPath: tempDir,
            defaultReader: new TextFileReader(),
            numWorkers: 4, // Use 4 concurrent workers for better performance
          });
          
          console.log(`✅ Loaded ${documents.length} documents successfully`);
          
          // Fix document metadata to use final pyodide mount paths instead of temp paths
          if (documents.length > 0 && tempDir) {
            console.log("🔧 Fixing document metadata to use final mount paths...");
            this.fixDocumentMetadataPaths(documents, tempDir, mountData);
            console.log("✅ Document metadata paths fixed");
          }
          
          if (documents.length > 0) {
            // Create the vector index from documents
            console.log("📦 Creating VectorStoreIndex from documents...");
            const index = await VectorStoreIndex.fromDocuments(documents);
            console.log("✅ VectorStoreIndex created successfully");
            
            // Create retriever
            console.log("🔧 Creating retriever...");
            this.retriever = index.asRetriever();
            console.log("✅ Retriever created successfully");
            
            // Create query engine
            console.log("🔧 Creating query engine...");
            this.queryEngine = index.asQueryEngine();
            console.log("✅ Query engine created successfully");
            
            console.log(`🎉 Vector index created successfully with ${documents.length} documents`);
            this.logger.info(`Vector index created successfully with ${documents.length} documents`);
          } else {
            console.log("⚠️  No documents loaded by SimpleDirectoryReader");
            this.logger.warn("No documents loaded by SimpleDirectoryReader");
          }
        } catch (indexError) {
          console.error("❌ Failed to create vector index:", indexError);
          throw new Error(`Vector index creation failed: ${indexError instanceof Error ? indexError.message : String(indexError)}`);
        }
      } else {
        console.log("⚠️  No files to ingest");
        this.logger.warn("No files to ingest");
      }
      
      console.log("✅ performIngestion completed successfully");
    } catch (error) {
      console.error("❌ Error in performIngestion:", error);
      if (error instanceof Error && error.stack) {
        console.error("Stack trace:", error.stack);
      }
      throw error;
    } finally {
      // Clean up temporary directory
      if (tempDir) {
        try {
          console.log(`🧹 Cleaning up temporary directory: ${tempDir}`);
          await Deno.remove(tempDir, { recursive: true });
          console.log("✅ Temporary directory cleaned up");
        } catch (cleanupError) {
          console.warn("⚠️  Failed to clean up temporary directory:", cleanupError);
          this.logger.warn(`Failed to clean up temporary directory: ${tempDir}`, { 
            error: String(cleanupError) 
          });
        }
      }
    }
  }

  /**
   * Fix document metadata to use final pyodide mount paths instead of temporary directory paths
   */
  private fixDocumentMetadataPaths(
    documents: Document[],
    tempDir: string,
    mountData: Array<{ hostPath: string; targetPath?: string; files: Array<{ path: string; content: Uint8Array }> }>,
  ): void {
    // Create a mapping from temp paths to final mount paths
    const pathMapping = new Map<string, string>();
    
    for (const { hostPath, targetPath, files } of mountData) {
      // Use specified target path or create sanitized mount point (same logic as pyodide-worker.ts)
      const mountPoint = targetPath || `/mnt/${hostPath.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      
      for (const { path } of files) {
        const tempFilePath = join(tempDir, path);
        const finalMountPath = `${mountPoint}/${path}`;
        pathMapping.set(tempFilePath, finalMountPath);
      }
    }
    
    // Update document metadata
    for (const document of documents) {
      if (document.metadata && typeof document.metadata === 'object') {
        // Handle both 'path' and 'file_path' properties that might exist in metadata
        if ('path' in document.metadata && typeof document.metadata.path === 'string') {
          const finalPath = pathMapping.get(document.metadata.path);
          if (finalPath) {
            document.metadata.path = finalPath;
            document.metadata.file_path = finalPath; // Also set file_path for consistency
          }
        }
        
        if ('file_path' in document.metadata && typeof document.metadata.file_path === 'string') {
          const finalPath = pathMapping.get(document.metadata.file_path);
          if (finalPath) {
            document.metadata.file_path = finalPath;
            document.metadata.path = finalPath; // Also set path for consistency
          }
        }
        
        // Add the original hostPath information for potential future use
        const tempPath = document.metadata.path || document.metadata.file_path;
        if (typeof tempPath === 'string') {
          for (const { hostPath } of mountData) {
            const mountPoint = `/mnt/${hostPath.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
            if (tempPath.startsWith(mountPoint)) {
              document.metadata.hostPath = hostPath;
              document.metadata.mountPoint = mountPoint;
              break;
            }
          }
        }
      }
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
   * Retrieve file paths that match a query
   */
  async retrieveFilePaths(queryText: string): Promise<string[]> {
    // Check if ingestion is still in progress
    if (this.isIngesting && !this.ingestionComplete) {
      this.logger.info("File path retrieval requested while ingestion in progress, waiting for completion...");
      
      if (this.ingestionPromise) {
        await this.ingestionPromise;
      }
    }

    if (!this.retriever) {
      throw new Error("Vector store not initialized or no documents ingested");
    }

    this.logger.info(`Executing file path retrieval for query: "${queryText}"`);

    try {
      const response = await this.retriever.retrieve({ query: queryText });
      
      // Extract file paths from the retrieval results
      const filePaths: string[] = [];
      
      if (Array.isArray(response)) {
        for (const item of response) {
          if (item && item.node && item.node.metadata) {
            const metadata = item.node.metadata;
            // Use file_path or path - these now contain the final mount paths
            const filePath = metadata.file_path || metadata.path;
            if (filePath && typeof filePath === 'string') {
              filePaths.push(filePath);
            }
          }
        }
      } else if (response && typeof response === 'object') {
        // Handle single response object
        if (response.node && response.node.metadata) {
          const metadata = response.node.metadata;
          const filePath = metadata.file_path || metadata.path;
          if (filePath && typeof filePath === 'string') {
            filePaths.push(filePath);
          }
        }
      }

      // Remove duplicates
      const uniqueFilePaths = [...new Set(filePaths)];

      this.logger.info(`File path retrieval completed successfully`, {
        uniquePathCount: uniqueFilePaths.length,
        totalItems: Array.isArray(response) ? response.length : 1,
      });

      return uniqueFilePaths;
    } catch (error) {
      this.logger.error("File path retrieval execution failed", { error: String(error) });
      throw new Error(`File path retrieval failed: ${error instanceof Error ? error.message : String(error)}`);
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
    this.retriever = null;
    this.isIngesting = false;
    this.ingestionComplete = false;
    this.ingestionPromise = null;
    embeddingConfigured = false; // Allow reconfiguration after reset
    this.logger.info("Vector store reset");
  }
}

// Global singleton instance
let vectorStoreInstance: VectorStoreService | null = null;
// Global flag to track if vector store indexing is enabled
let vectorStoreIndexingEnabled = false;

/**
 * Enable vector store indexing globally
 */
export function enableVectorStoreIndexing(): void {
  vectorStoreIndexingEnabled = true;
}

/**
 * Check if vector store indexing is enabled
 */
export function isVectorStoreIndexingEnabled(): boolean {
  return vectorStoreIndexingEnabled;
}

/**
 * Get the singleton vector store instance
 */
export function getVectorStore(): VectorStoreService {
  console.log("🔍 getVectorStore() called");
  
  if (!vectorStoreInstance) {
    console.log("📦 Creating new VectorStoreService singleton...");
    try {
      vectorStoreInstance = new VectorStoreService();
      console.log("✅ VectorStoreService singleton created successfully");
    } catch (error) {
      console.error("❌ Failed to create VectorStoreService singleton:", error);
      throw error;
    }
  } else {
    console.log("♻️  Returning existing VectorStoreService instance");
  }
  
  return vectorStoreInstance;
}

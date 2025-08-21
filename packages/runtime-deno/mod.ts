// @runt/runtime-deno - Deno platform adapter for runtime agents

// Re-export core functionality from runtime-core
export {
  ArtifactClient,
  createArtifactClient,
  createLogger,
  Logger,
  logger,
  LogLevel,
  type MediaBundle,
  PngProcessor,
  RuntimeAgent,
  validateMediaBundle,
  withQuietLogging,
} from "@runt/runtime-core";

export type {
  AiModel,
  ArtifactSubmissionOptions,
  ArtifactSubmissionResult,
  CancellationHandler,
  CellData,
  ExecutionContext,
  ExecutionHandler,
  ExecutionQueueData,
  ExecutionResult,
  LoggerConfig,
  ModelCapability,
  OutputType,
  RawOutputData,
  RuntimeAgentEventHandlers,
  RuntimeAgentOptions,
  RuntimeCapabilities,
  RuntimeSessionData,
} from "@runt/runtime-core";

// Node-specific functionality (CLI, configuration, etc.)
export {
  createRuntimeConfig,
  DEFAULT_CONFIG,
  parseRuntimeArgs,
  RuntimeConfig,
} from "./src/config.ts";

export { runner } from "./src/runtime-runner.ts";

// Store creation helpers
export {
  createStoreFromConfig,
  type RuntimeSchema,
} from "./src/store-helpers.ts";

// Node-specific functionality
// TODO: Implement node-specific runtime creation helpers
// export { createNodeRuntimeAgent } from "./src/node-runtime.ts";

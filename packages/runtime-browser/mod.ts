// @runt/runtime-browser - Browser platform adapter for runtime agents

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

// Browser-specific functionality
// TODO: Implement browser-specific runtime creation and lifecycle management
// export { createBrowserRuntimeAgent } from "./src/browser-runtime.ts";

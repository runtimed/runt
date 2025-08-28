// @runt/lib - Core library for building Anode runtime agents

export { RuntimeAgent } from "./src/runtime-agent.ts";
export {
  createRuntimeConfig,
  DEFAULT_CONFIG,
  parseRuntimeArgs,
  RuntimeConfig,
} from "./src/config.ts";
export {
  createLogger,
  Logger,
  logger,
  LogLevel,
  withQuietLogging,
} from "./src/logging.ts";
export type {
  AiModel,
  CancellationHandler,
  CellData,
  ExecutionContext,
  ExecutionHandler,
  ExecutionQueueData,
  ExecutionResult,
  ModelCapability,
  OutputType,
  RawOutputData,
  RuntimeAgentEventHandlers,
  RuntimeAgentOptions,
  RuntimeCapabilities,
  RuntimeSessionData,
} from "./src/types.ts";

// Authentication utilities
export { discoverUserIdentity, generateRuntimeClientId } from "./src/auth.ts";
export type { DiscoverUserIdentityOptions, UserInfo } from "./src/auth.ts";
export type { LoggerConfig } from "./src/logging.ts";

// Media types and utilities for rich content handling
export * from "./src/media/mod.ts";

// Artifact service client for submitting artifacts to anode
export {
  ArtifactClient,
  createArtifactClient,
  PngProcessor,
} from "./src/artifact-client.ts";

export type {
  ArtifactSubmissionOptions,
  ArtifactSubmissionResult,
} from "./src/types.ts";

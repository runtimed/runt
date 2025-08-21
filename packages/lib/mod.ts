// @runt/lib - Backward compatibility wrapper for runtime agents
//
// This package re-exports functionality from the new runtime packages:
// - @runt/runtime-core: Platform-agnostic runtime agent core
// - @runt/runtime-deno: Deno-specific CLI configuration and utilities
//
// For new projects, consider using the specific packages directly:
// - Use @runt/runtime-core for platform-agnostic runtime agents
// - Use @runt/runtime-deno for Deno/Node.js applications with CLI support
// - Use @runt/runtime-browser for browser-based applications

// Core runtime agent functionality (from @runt/runtime-core)
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

// Type exports (from @runt/runtime-core)
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

// Deno-specific functionality (from @runt/runtime-deno)
export {
  createRuntimeConfig,
  DEFAULT_CONFIG,
  parseRuntimeArgs,
  runner,
  type RuntimeConfig,
} from "@runt/runtime-deno";

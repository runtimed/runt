// @runt/lib-web - Web runtime agent library
//
// This package provides utilities for building runtime agents that can run
// in web environments, including configuration management, artifact handling,
// and structured logging.

// Configuration and runtime setup
export {
  DEFAULT_CONFIG,
  getTestingMode,
  RuntimeConfig,
  setTestingMode,
} from "./src/config.ts";

export { RuntimeAgent } from "./src/runtime-agent.ts";

// Artifact handling
export {
  ArtifactClient,
  createArtifactClient,
  PngProcessor,
} from "./src/artifact-client.ts";

// Logging utilities
export {
  createLogger,
  Logger,
  logger,
  type LoggerConfig,
  LogLevel,
  withQuietLogging,
} from "./src/logging.ts";

export * from "./src/types.ts";

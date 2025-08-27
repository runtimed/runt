// Configuration utilities for Anode runtime agents
//
// This module provides utilities for parsing command-line arguments and
// environment variables to configure runtime agents with sensible defaults.

import type {
  IArtifactClient,
  RuntimeAgentOptions,
  RuntimeCapabilities,
} from "./types.ts";
import { ArtifactClient } from "./artifact-client.ts";

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  syncUrl: "wss://app.runt.run/livestore",
  imageArtifactThresholdBytes: 6 * 1024, // 6KB threshold for uploading images as artifacts
} as const;

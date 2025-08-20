// Configuration utilities for Anode runtime agents
//
// This module provides utilities for parsing command-line arguments and
// environment variables to configure runtime agents with sensible defaults.

import { createLogger } from "./logging.ts";
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
  syncUrl: "wss://anode-docworker.rgbkrk.workers.dev",
  imageArtifactThresholdBytes: 6 * 1024, // 6KB threshold for uploading images as artifacts
} as const;

/**
 * Configuration class for runtime agents
 */
export class RuntimeConfig {
  public readonly runtimeId: string;
  public readonly runtimeType: string;
  public readonly syncUrl: string;
  public readonly authToken: string;
  public readonly notebookId: string;
  public readonly capabilities: RuntimeCapabilities;
  public readonly sessionId: string;
  public readonly environmentOptions: RuntimeAgentOptions["environmentOptions"];
  public readonly imageArtifactThresholdBytes: number;
  public readonly artifactClient: IArtifactClient;

  constructor(options: RuntimeAgentOptions) {
    this.runtimeId = options.runtimeId;
    this.runtimeType = options.runtimeType;
    this.syncUrl = options.syncUrl;
    this.authToken = options.authToken;
    this.notebookId = options.notebookId;
    this.capabilities = options.capabilities;
    this.environmentOptions = options.environmentOptions;
    this.imageArtifactThresholdBytes = options.imageArtifactThresholdBytes ??
      DEFAULT_CONFIG.imageArtifactThresholdBytes;

    // Use injected artifact client or create default one
    this.artifactClient = options.artifactClient ??
      new ArtifactClient(this.getArtifactServiceUrl(options.syncUrl));

    // Generate unique session ID
    this.sessionId = `${this.runtimeType}-${this.runtimeId}-${Date.now()}-${
      Math.random().toString(36).substring(2, 15)
    }`;
  }

  /**
   * Convert sync URL to artifact service URL
   * Transforms WebSocket URLs to HTTP(S) URLs for the artifact service
   */
  private getArtifactServiceUrl(syncUrl: string): string {
    try {
      const url = new URL(syncUrl);
      // Convert wss:// to https:// and ws:// to http://
      const protocol = url.protocol === "wss:" ? "https:" : "http:";
      return `${protocol}//${url.host}`;
    } catch (error) {
      // Fallback to default if URL parsing fails
      const logger = createLogger("runtime-config");
      logger.warn(
        "Failed to parse sync URL for artifact service, using default",
        {
          syncUrl,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return "https://api.runt.run";
    }
  }

  /**
   * Validate that all required configuration is present
   */
  validate(): void {
    const missing: { field: string; suggestion: string }[] = [];

    if (!this.authToken) {
      missing.push({
        field: "authToken",
        suggestion:
          "--auth-token <token> or RUNT_API_KEY env var (AUTH_TOKEN as fallback)",
      });
    }
    if (!this.notebookId) {
      missing.push({
        field: "notebookId",
        suggestion: "--notebook <id> or NOTEBOOK_ID env var",
      });
    }
    if (!this.runtimeId) {
      missing.push({
        field: "runtimeId",
        suggestion: "--runtime-id <id> or RUNTIME_ID env var",
      });
    }
    if (!this.runtimeType) {
      missing.push({
        field: "runtimeType",
        suggestion: "--runtime-type <type> or RUNTIME_TYPE env var",
      });
    }

    if (missing.length > 0) {
      const messages = missing.map(
        ({ field, suggestion }) => `  ${field}: ${suggestion}`,
      );
      throw new Error(
        `Missing required configuration:\n\n${
          messages.join("\n")
        }\n\nUse --help for more information.`,
      );
    }

    if (this.environmentOptions) {
      const invalid: string[] = [];
      const { runtimePackageManager, runtimePythonPath, runtimeEnvPath } =
        this.environmentOptions;
      if (runtimePackageManager && runtimePackageManager !== "pip") {
        invalid.push(`--runtime-package-manager`);
      }

      if (runtimePythonPath !== undefined && !runtimePythonPath) {
        invalid.push(`--runtime-python-path`);
      }
      if (runtimeEnvPath !== undefined && !runtimeEnvPath) {
        invalid.push(`--runtime-env-path`);
      }

      if (invalid.length > 0) {
        throw new Error(
          `Invalid value for:\n\n${
            invalid.join("\n")
          }\n\nUse --help for more information.`,
        );
      }
    }
  }
}

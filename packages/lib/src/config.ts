// Configuration utilities for Anode runtime agents
//
// This module provides minimal, generic configuration interfaces that can be
// extended by specific runtime implementations (Python, JavaScript, etc.).

import { logger } from "./logging.ts";
import type { Adapter } from "jsr:@runtimed/schema";
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
  syncUrl: "wss://app.runt.run",
  imageArtifactThresholdBytes: 6 * 1024, // 6KB threshold for uploading images as artifacts
} as const;

/**
 * Core configuration class for runtime agents
 * Can be extended by specific runtime implementations
 */
export class RuntimeConfig {
  public readonly runtimeId: string;
  public readonly runtimeType: string;
  public readonly syncUrl: string;
  public readonly authToken: string;
  public readonly notebookId: string;
  public readonly capabilities: RuntimeCapabilities;
  public readonly sessionId: string;
  public readonly imageArtifactThresholdBytes: number;
  public readonly artifactClient: IArtifactClient;
  public readonly adapter: Adapter | undefined;
  public readonly userId: string;

  constructor(options: RuntimeAgentOptions) {
    this.runtimeId = options.runtimeId;
    this.runtimeType = options.runtimeType;
    this.syncUrl = options.syncUrl;
    this.authToken = options.authToken;
    this.notebookId = options.notebookId;
    this.capabilities = options.capabilities;
    this.imageArtifactThresholdBytes = options.imageArtifactThresholdBytes ??
      DEFAULT_CONFIG.imageArtifactThresholdBytes;
    this.adapter = options.adapter;
    this.userId = options.userId;

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
        suggestion: "AUTH_TOKEN or RUNT_API_KEY environment variable",
      });
    }
    if (!this.notebookId) {
      missing.push({
        field: "notebookId",
        suggestion: "NOTEBOOK_ID environment variable",
      });
    }
    if (!this.runtimeId) {
      missing.push({
        field: "runtimeId",
        suggestion: "RUNTIME_ID environment variable",
      });
    }
    if (!this.runtimeType) {
      missing.push({
        field: "runtimeType",
        suggestion: "RUNTIME_TYPE environment variable",
      });
    }

    if (missing.length > 0) {
      const messages = missing.map(
        ({ field, suggestion }) => `  ${field}: ${suggestion}`,
      );
      throw new Error(
        `Missing required configuration:\n\n${
          messages.join("\n")
        }\n\nConsult your runtime implementation for configuration details.`,
      );
    }
  }
}

// Configuration utilities for Anode runtime agents
//
// This module provides minimal, generic configuration interfaces that can be
// extended by specific runtime implementations (Python, JavaScript, etc.).

import { parseArgs } from "@std/cli/parse-args";
import { logger } from "./logging.ts";
import type { Adapter } from "npm:@livestore/livestore";
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
  public readonly clientId: string;

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
    this.clientId = options.clientId;

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

/**
 * Parse minimal command-line arguments for runtime agent configuration
 * Runtime implementations can extend this with their own argument parsing
 */
export function parseBaseRuntimeArgs(
  args: string[],
): Partial<RuntimeAgentOptions> {
  const parsed = parseArgs(args, {
    string: [
      "notebook",
      "auth-token",
      "sync-url",
      "runtime-id",
      "runtime-type",
      "image-artifact-threshold",
    ],
    boolean: ["help"],
    alias: {
      n: "notebook",
      t: "auth-token",
      s: "sync-url",
      r: "runtime-id",
      T: "runtime-type",
      h: "help",
    },
  });

  if (parsed.help) {
    console.log(`
Basic Runtime Agent Configuration

Required:
  --notebook, -n <id>        Notebook ID to connect to
  --auth-token, -t <token>   Authentication token for sync

Optional:
  --sync-url, -s <url>       WebSocket URL for LiveStore sync
                             (default: ${DEFAULT_CONFIG.syncUrl})
  --runtime-id, -R <id>      Runtime identifier
  --runtime-type, -T <type>  Runtime type identifier
  --help, -h                 Show this help message

Environment Variables:
  NOTEBOOK_ID, RUNT_API_KEY, AUTH_TOKEN, LIVESTORE_SYNC_URL, RUNTIME_ID, RUNTIME_TYPE

For runtime-specific options, consult your runtime implementation documentation.
    `);
    Deno.exit(0);
  }

  let result: Partial<RuntimeAgentOptions> = {
    syncUrl: parsed["sync-url"] || Deno.env.get("LIVESTORE_SYNC_URL") ||
      DEFAULT_CONFIG.syncUrl,
  };

  const notebookId = parsed.notebook || Deno.env.get("NOTEBOOK_ID");
  if (notebookId) {
    result = { ...result, notebookId };
  }

  const authToken = parsed["auth-token"] ||
    Deno.env.get("RUNT_API_KEY") ||
    Deno.env.get("AUTH_TOKEN");
  if (authToken) {
    result = { ...result, authToken };
  }

  const runtimeType = parsed["runtime-type"] || Deno.env.get("RUNTIME_TYPE");
  if (runtimeType && typeof runtimeType === "string") {
    result = { ...result, runtimeType };
  }

  const runtimeId = parsed["runtime-id"] || Deno.env.get("RUNTIME_ID");
  if (runtimeId && typeof runtimeId === "string") {
    result = { ...result, runtimeId };
  }

  // Parse image artifact threshold
  const thresholdArg = parsed["image-artifact-threshold"] ||
    Deno.env.get("IMAGE_ARTIFACT_THRESHOLD_BYTES");
  if (thresholdArg) {
    const threshold = parseInt(thresholdArg, 10);
    if (!isNaN(threshold) && threshold > 0) {
      result = { ...result, imageArtifactThresholdBytes: threshold };
    }
  }

  return result;
}

/**
 * Create a basic runtime configuration from CLI args and defaults
 * Runtime implementations should extend this with their own createConfig function
 */
export function createBaseRuntimeConfig(
  args: string[],
  defaults: Partial<RuntimeAgentOptions> = {},
): RuntimeConfig {
  const cliConfig = parseBaseRuntimeArgs(args);

  // Merge CLI config with defaults - CLI args override defaults
  const mergedDefaults = {
    runtimeType: "runtime",
    syncUrl: DEFAULT_CONFIG.syncUrl,
    capabilities: {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: false,
    },
    ...defaults,
  };

  // Only include non-undefined values from CLI config
  const cleanCliConfig: Partial<RuntimeAgentOptions> = Object.fromEntries(
    Object.entries(cliConfig).filter(([_, value]) => value !== undefined),
  );

  // Compose the config object
  const runtimeId = cleanCliConfig.runtimeId ||
    Deno.env.get("RUNTIME_ID") ||
    `${
      cleanCliConfig.runtimeType || mergedDefaults.runtimeType
    }-runtime-${Deno.pid}`;

  const config: RuntimeAgentOptions = {
    ...mergedDefaults,
    ...cleanCliConfig,
    runtimeId,
  } as RuntimeAgentOptions;

  const runtimeConfig = new RuntimeConfig(config);
  runtimeConfig.validate();


  logger.debug("Runtime configuration created", {
    runtimeType: runtimeConfig.runtimeType,
    runtimeId: runtimeConfig.runtimeId,
    syncUrl: runtimeConfig.syncUrl,
    notebookId: runtimeConfig.notebookId,
    sessionId: runtimeConfig.sessionId,
  });

  return runtimeConfig;
}

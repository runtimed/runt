// Configuration utilities for Anode runtime agents
//
// This module provides utilities for parsing command-line arguments and
// environment variables to configure runtime agents with sensible defaults.

import { parseArgs } from "@std/cli/parse-args";
import { createLogger } from "./logging.ts";
import type { RuntimeAgentOptions, RuntimeCapabilities } from "./types.ts";

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  syncUrl: "wss://anode-docworker.rgbkrk.workers.dev",
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

  constructor(options: RuntimeAgentOptions) {
    this.runtimeId = options.runtimeId;
    this.runtimeType = options.runtimeType;
    this.syncUrl = options.syncUrl;
    this.authToken = options.authToken;
    this.notebookId = options.notebookId;
    this.capabilities = options.capabilities;

    // Generate unique session ID
    this.sessionId = `${this.runtimeType}-${this.runtimeId}-${Date.now()}-${
      Math.random().toString(36).slice(2)
    }`;
  }

  /**
   * Validate that all required configuration is present
   */
  validate(): void {
    const missing: { field: string; suggestion: string }[] = [];

    if (!this.authToken) {
      missing.push({
        field: "authToken",
        suggestion: "--auth-token <token> or AUTH_TOKEN env var",
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
  }
}

/**
 * Parse command-line arguments for runtime agent configuration
 */
export function parseRuntimeArgs(args: string[]): Partial<RuntimeAgentOptions> {
  const parsed = parseArgs(args, {
    string: [
      "notebook",
      "auth-token",
      "sync-url",
      "runtime-id",
      "runtime-type",
      "heartbeat-interval",
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
    // Help text should still go to console for CLI usability
    console.log(`
Runtime Agent Configuration

Usage:
  deno run --allow-net --allow-env main.ts [OPTIONS]

Required Options:
  --notebook, -n <id>        Notebook ID to connect to
  --auth-token, -t <token>   Authentication token for sync

Optional Options:
  --sync-url, -s <url>       WebSocket URL for LiveStore sync
                             (default: ${DEFAULT_CONFIG.syncUrl})
  --runtime-id, -R <id>      Runtime identifier
                             (default: <runtime-type>-runtime-{pid})
  --runtime-type, -T <type>  Runtime type identifier
                             (default: "runtime")
  --help, -h                 Show this help message

Examples:
  deno run --allow-net --allow-env main.ts -n my-notebook -t your-token
  deno run --allow-net --allow-env main.ts --notebook=test --auth-token=abc123

Environment Variables (fallback):
  NOTEBOOK_ID, AUTH_TOKEN, LIVESTORE_SYNC_URL, RUNTIME_ID, RUNTIME_TYPE

Logging Configuration:
  RUNT_LOG_LEVEL             Set to DEBUG, INFO, WARN, or ERROR (default: INFO)
  RUNT_DISABLE_CONSOLE_LOGS  Set to disable console output
    `);
    Deno.exit(0);
  }

  const result: Partial<RuntimeAgentOptions> = {
    syncUrl: parsed["sync-url"] || Deno.env.get("LIVESTORE_SYNC_URL") ||
      DEFAULT_CONFIG.syncUrl,
  };

  const notebookId = parsed.notebook || Deno.env.get("NOTEBOOK_ID");
  if (notebookId) result.notebookId = notebookId;

  const authToken = parsed["auth-token"] || Deno.env.get("AUTH_TOKEN");
  if (authToken) result.authToken = authToken;

  const runtimeType = parsed["runtime-type"] || Deno.env.get("RUNTIME_TYPE");
  if (runtimeType && typeof runtimeType === "string") {
    result.runtimeType = runtimeType;
  }

  const runtimeId = parsed["runtime-id"] || Deno.env.get("RUNTIME_ID");
  if (runtimeId && typeof runtimeId === "string") result.runtimeId = runtimeId;

  return result;
}

/**
 * Create a complete runtime configuration from CLI args and defaults
 */
export function createRuntimeConfig(
  args: string[],
  defaults: Partial<RuntimeAgentOptions> = {},
): RuntimeConfig {
  const cliConfig = parseRuntimeArgs(args);

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
  const cleanCliConfig = Object.fromEntries(
    Object.entries(cliConfig).filter(([_, value]) => value !== undefined),
  );

  const config: RuntimeAgentOptions = {
    ...mergedDefaults,
    ...cleanCliConfig,
  } as RuntimeAgentOptions;

  // Generate runtimeId after merging to use correct runtimeType
  if (!config.runtimeId) {
    config.runtimeId = cliConfig.runtimeId ||
      Deno.env.get("RUNTIME_ID") ||
      `${config.runtimeType}-runtime-${Deno.pid}`;
  }

  const runtimeConfig = new RuntimeConfig(config);
  runtimeConfig.validate();

  const logger = createLogger("config");
  logger.debug("Runtime configuration created", {
    runtimeType: runtimeConfig.runtimeType,
    runtimeId: runtimeConfig.runtimeId,
    syncUrl: runtimeConfig.syncUrl,
    notebookId: runtimeConfig.notebookId,
    sessionId: runtimeConfig.sessionId,
  });

  return runtimeConfig;
}

// Configuration utilities for Anode runtime agents
//
// This module provides utilities for parsing command-line arguments and
// environment variables to configure runtime agents with sensible defaults.

import { parseArgs } from "@std/cli/parse-args";
import { createLogger } from "./logging.ts";
import type { KernelCapabilities, RuntimeAgentOptions } from "./types.ts";

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
  public readonly kernelId: string;
  public readonly kernelType: string;
  public readonly syncUrl: string;
  public readonly authToken: string;
  public readonly notebookId: string;
  public readonly capabilities: KernelCapabilities;
  public readonly sessionId: string;

  constructor(options: RuntimeAgentOptions) {
    this.kernelId = options.kernelId;
    this.kernelType = options.kernelType;
    this.syncUrl = options.syncUrl;
    this.authToken = options.authToken;
    this.notebookId = options.notebookId;
    this.capabilities = options.capabilities;

    // Generate unique session ID
    this.sessionId = `${this.kernelId}-${Date.now()}-${
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
    if (!this.kernelId) {
      missing.push({
        field: "kernelId",
        suggestion: "--kernel-id <id> or KERNEL_ID env var",
      });
    }
    if (!this.kernelType) {
      missing.push({
        field: "kernelType",
        suggestion: "--kernel-type <type> or KERNEL_TYPE env var",
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
      "kernel-id",
      "kernel-type",
      "heartbeat-interval",
    ],
    boolean: ["help"],
    alias: {
      n: "notebook",
      t: "auth-token",
      s: "sync-url",
      k: "kernel-id",
      T: "kernel-type",
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
  --kernel-id, -k <id>       Unique kernel identifier
                             (default: <kernel-type>-kernel-{pid})
  --kernel-type, -T <type>   Kernel type identifier
                             (default: "runtime")
  --help, -h                 Show this help message

Examples:
  deno run --allow-net --allow-env main.ts -n my-notebook -t your-token
  deno run --allow-net --allow-env main.ts --notebook=test --auth-token=abc123

Environment Variables (fallback):
  NOTEBOOK_ID, AUTH_TOKEN, LIVESTORE_SYNC_URL, KERNEL_ID, KERNEL_TYPE

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

  const kernelId = parsed["kernel-id"] || Deno.env.get("KERNEL_ID");
  if (kernelId) result.kernelId = kernelId;

  const kernelType = parsed["kernel-type"] || Deno.env.get("KERNEL_TYPE");
  if (kernelType) result.kernelType = kernelType;

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
    kernelType: "runtime",
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
    // Generate kernelId after merging to use correct kernelType
    kernelId: cliConfig.kernelId ||
      Deno.env.get("KERNEL_ID") ||
      `${mergedDefaults.kernelType}-kernel-${Deno.pid}`,
  } as RuntimeAgentOptions;

  const runtimeConfig = new RuntimeConfig(config);
  runtimeConfig.validate();

  const logger = createLogger("config");
  logger.debug("Runtime configuration created", {
    kernelType: runtimeConfig.kernelType,
    kernelId: runtimeConfig.kernelId,
    syncUrl: runtimeConfig.syncUrl,
    notebookId: runtimeConfig.notebookId,
    sessionId: runtimeConfig.sessionId,
  });

  return runtimeConfig;
}

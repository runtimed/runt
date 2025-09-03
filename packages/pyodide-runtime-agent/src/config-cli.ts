// CLI configuration utilities for runtime agents
//
// This module provides CLI argument parsing and config creation functions
// that runtime implementations can use to bootstrap from command line.

import { parseArgs } from "@std/cli/parse-args";
import { DEFAULT_CONFIG, logger, RuntimeConfig } from "@runt/lib";
import type { RuntimeAgentOptions } from "@runt/lib";

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

import { parseArgs } from "@std/cli/parse-args";

function leftovers() {
  // Create LiveStore adapter for real-time collaboration
  const adapter = makeAdapter({
    storage: { type: "in-memory" },
    sync: {
      backend: makeCfSync({ url: this.config.syncUrl }),
      onSyncError: "ignore",
    },
  });

  this.#store = await createStorePromise({
    adapter,
    schema,
    storeId: this.config.notebookId,
    syncPayload: {
      authToken: this.config.authToken,
      runtime: true,
      runtimeId: this.config.runtimeId,
      sessionId: this.config.sessionId,
      clientId: userId,
    },
  });
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
      "runtime-python-path",
      "runtime-env-path",
      "runtime-package-manager",
      "image-artifact-threshold",
      "mount",
      "output-dir",
      "ai-max-iterations",
    ],
    boolean: [
      "help",
      "runtime-env-externally-managed",
      "index-mounted-files",
      "mount-readonly",
    ],
    alias: {
      n: "notebook",
      t: "auth-token",
      s: "sync-url",
      r: "runtime-id",
      T: "runtime-type",
      h: "help",
      m: "mount",
    },
    collect: ["mount"], // Allow multiple --mount arguments
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
  --mount, -m <path>         Host directory to mount. Supports two formats:
                             1. Simple: /path/to/local (mounts to auto-generated /mnt/ path)
                             2. Docker-style: /path/to/local:/target/path
                             Examples: --mount /data or --mount /data:/dataset
                             (can be specified multiple times)
  --output-dir <path>        Host directory to sync /outputs to after each cell execution
  --mount-readonly           Mount directories as read-only (prevents modification)
                             (only applies when --mount is also used)
  --index-mounted-files      Enable vector store indexing of mounted files for AI search
                             (only applies when --mount is also used)
  --ai-max-iterations <num>  Maximum iterations for AI agent tool calling loops
                             (default: 10)
  --help, -h                 Show this help message

Examples:
  deno run --allow-net --allow-env main.ts -n my-notebook -t your-token
  deno run --allow-net --allow-env main.ts --notebook=test --auth-token=abc123
  deno run --allow-net --allow-env main.ts -n my-notebook -t token --mount /path/to/data
  deno run --allow-net --allow-env main.ts -n my-notebook -t token --mount /host/data:/data/dataset --index-mounted-files

Environment Variables (fallback):
  NOTEBOOK_ID, RUNT_API_KEY, LIVESTORE_SYNC_URL, RUNTIME_ID, RUNTIME_TYPE
  IMAGE_ARTIFACT_THRESHOLD_BYTES
  AUTH_TOKEN (legacy fallback for service-level authentication)

OpenAI Embedding Configuration (for --index-mounted-files):
  OPENAI_EMBEDDING_API_KEY       OpenAI API key for optimal vector store embeddings
  OPENAI_EMBEDDING_MODEL         OpenAI embedding model (default: text-embedding-3-large)

Logging Configuration:
  RUNT_LOG_LEVEL             Set to DEBUG, INFO, WARN, or ERROR (default: INFO)
  RUNT_DISABLE_CONSOLE_LOGS  Set to disable console output
    `);
    Deno.exit(0);
  }

  let result: Partial<RuntimeAgentOptions> = {
    syncUrl: parsed["sync-url"] || Deno.env.get("LIVESTORE_SYNC_URL") ||
      DEFAULT_CONFIG.syncUrl,
  };

  const notebookId = parsed.notebook || Deno.env.get("NOTEBOOK_ID");
  if (notebookId) {
    result = {
      ...result,
      notebookId,
    };
  }

  const authToken = parsed["auth-token"] ||
    Deno.env.get("RUNT_API_KEY") ||
    Deno.env.get("AUTH_TOKEN");
  if (authToken) {
    result = {
      ...result,
      authToken,
    };
  }

  const runtimeType = parsed["runtime-type"] || Deno.env.get("RUNTIME_TYPE");
  if (runtimeType && typeof runtimeType === "string") {
    result = {
      ...result,
      runtimeType,
    };
  }

  const runtimeId = parsed["runtime-id"] || Deno.env.get("RUNTIME_ID");
  if (runtimeId && typeof runtimeId === "string") {
    result = {
      ...result,
      runtimeId,
    };
  }

  // Handle mount paths - support both simple paths and Docker-style local:target format
  if (parsed.mount && parsed.mount.length > 0) {
    const mountArgs = Array.isArray(parsed.mount)
      ? parsed.mount
      : [parsed.mount];
    const mountPaths: string[] = [];
    const mountMappings: Array<{ hostPath: string; targetPath: string }> = [];

    for (const mountArg of mountArgs) {
      if (mountArg.includes(":")) {
        // Docker-style mount: local-path:target-path
        const [hostPath, targetPath] = mountArg.split(":", 2);
        if (hostPath && targetPath) {
          mountMappings.push({ hostPath, targetPath });
          // Also add to mountPaths for backward compatibility
          mountPaths.push(hostPath);
        } else {
          throw new Error(
            `Invalid mount format: ${mountArg}. Expected format: <local-path>:<target-path>`,
          );
        }
      } else {
        // Simple path format (legacy)
        mountPaths.push(mountArg);
      }
    }

    result = {
      ...result,
      mountPaths,
      mountMappings,
    };
  }

  // Handle index-mounted-files flag
  if (parsed["index-mounted-files"]) {
    result = {
      ...result,
      indexMountedFiles: true,
    };
  }

  // Handle mount-readonly flag
  if (parsed["mount-readonly"]) {
    result = {
      ...result,
      mountReadonly: true,
    };
  }

  // Handle output-dir option
  const outputDir = parsed["output-dir"] || Deno.env.get("OUTPUT_DIR");
  if (outputDir && typeof outputDir === "string") {
    result = {
      ...result,
      outputDir,
    };
  }

  const environmentOptions: Record<string, unknown> = {};
  environmentOptions.runtimePythonPath = parsed["runtime-python-path"] ||
    Deno.env.get("RUNTIME_PYTHON_PATH") ||
    "python3";
  if (parsed["runtime-env-path"] || Deno.env.get("RUNTIME_ENV_PATH")) {
    environmentOptions.runtimeEnvPath = parsed["runtime-env-path"] ||
      Deno.env.get("RUNTIME_ENV_PATH");
  }
  environmentOptions.runtimePackageManager =
    parsed["runtime-package-manager"] ||
    Deno.env.get("RUNTIME_PACKAGE_MANAGER") ||
    "pip";
  const cliExternallyManaged = Boolean(
    parsed["runtime-env-externally-managed"],
  );
  const envExternallyManaged =
    Deno.env.get("RUNTIME_ENV_EXTERNALLY_MANAGED") === "1" ||
    Deno.env.get("RUNTIME_ENV_EXTERNALLY_MANAGED") === "true";
  environmentOptions.runtimeEnvExternallyManaged = cliExternallyManaged ||
    envExternallyManaged;
  result = {
    ...result,
    environmentOptions,
  };

  // Parse image artifact threshold
  const thresholdArg = parsed["image-artifact-threshold"] ||
    Deno.env.get("IMAGE_ARTIFACT_THRESHOLD_BYTES");
  if (thresholdArg) {
    const threshold = parseInt(thresholdArg, 10);
    if (!isNaN(threshold) && threshold > 0) {
      result = {
        ...result,
        imageArtifactThresholdBytes: threshold,
      };
    }
  }

  // Parse AI max iterations
  const aiMaxIterationsArg = parsed["ai-max-iterations"] ||
    Deno.env.get("AI_MAX_ITERATIONS");
  if (aiMaxIterationsArg) {
    const aiMaxIterations = parseInt(aiMaxIterationsArg, 10);
    if (!isNaN(aiMaxIterations) && aiMaxIterations > 0) {
      result = {
        ...result,
        aiMaxIterations,
      };
    }
  }

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
    environmentOptions: {
      runtimePythonPath: "python3",
      runtimePackageManager: "pip",
      runtimeEnvExternallyManaged: false,
      ...(defaults.environmentOptions ?? {}),
    },
    ...defaults,
  };

  // Only include non-undefined values from CLI config
  const cleanCliConfig: Partial<RuntimeAgentOptions> = Object.fromEntries(
    Object.entries(cliConfig).filter(([_, value]) => value !== undefined),
  );

  // Compose the config object without mutating any readonly property
  const runtimeId = cleanCliConfig.runtimeId ||
    Deno.env.get("RUNTIME_ID") ||
    `${
      cleanCliConfig.runtimeType || mergedDefaults.runtimeType
    }-runtime-${Deno.pid}`;

  const config: RuntimeAgentOptions = {
    ...mergedDefaults,
    ...cleanCliConfig,
    runtimeId,
    environmentOptions: {
      ...mergedDefaults.environmentOptions,
      ...(cleanCliConfig.environmentOptions ?? {}),
    },
  } as RuntimeAgentOptions;

  const runtimeConfig = new RuntimeConfig(config);
  runtimeConfig.validate();

  const logger = createLogger("config");
  logger.debug("Runtime configuration created", {
    runtimeType: runtimeConfig.runtimeType,
    runtimeId: runtimeConfig.runtimeId,
    syncUrl: runtimeConfig.syncUrl,
    notebookId: runtimeConfig.notebookId,
    sessionId: runtimeConfig.sessionId,
    environmentOptions: config.environmentOptions,
  });

  return runtimeConfig;
}

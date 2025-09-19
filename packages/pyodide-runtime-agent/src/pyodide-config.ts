// Pyodide-specific configuration utilities
//
// This module extends the base runtime configuration with Pyodide-specific
// options like file mounting, AI capabilities, Python environment settings,
// and vector store indexing.

import { parseArgs } from "@std/cli/parse-args";
import { DEFAULT_CONFIG, RuntimeConfig } from "@runtimed/agent-core";
import type { RuntimeAgentOptions } from "@runtimed/agent-core";
import { logger } from "@runtimed/agent-core";
import { parseBaseRuntimeArgs } from "./config-cli.ts";

/**
 * Pyodide-specific configuration options
 */
export interface PyodideRuntimeAgentOptions extends RuntimeAgentOptions {
  /** Host directories to mount into the runtime filesystem */
  readonly mountPaths?: string[];
  /** Mount mappings for Docker-style mounts: local-path -> target-path */
  readonly mountMappings?: Array<{ hostPath: string; targetPath: string }>;
  /** Whether to index mounted files in vector store for AI search */
  readonly indexMountedFiles?: boolean;
  /** Whether to mount directories as read-only */
  readonly mountReadonly?: boolean;
  /** Host directory where files from /outputs will be synced */
  readonly outputDir?: string;
  /** Environment-related options for the Python runtime */
  readonly environmentOptions: Readonly<{
    /** Path to the python executable to use (default: "python3") */
    readonly runtimePythonPath?: string;
    /** Path to the environment/venv to use (default: unset) */
    readonly runtimeEnvPath?: string;
    /** Package manager to use (default: "pip") */
    readonly runtimePackageManager?: string;
    /** If true, treat the environment as externally managed (default: false) */
    readonly runtimeEnvExternallyManaged?: boolean;
  }>;
  /** Maximum iterations for AI agent tool calling loops (default: 10) */
  readonly aiMaxIterations?: number;
}

/**
 * Pyodide-specific configuration class
 */
export class PyodideRuntimeConfig extends RuntimeConfig {
  public readonly environmentOptions:
    PyodideRuntimeAgentOptions["environmentOptions"];
  public readonly mountPaths: string[];
  public readonly mountMappings: Array<
    { hostPath: string; targetPath: string }
  >;
  public readonly indexMountedFiles: boolean;
  public readonly mountReadonly: boolean;
  public readonly outputDir: string | undefined;
  public readonly aiMaxIterations: number;

  constructor(options: PyodideRuntimeAgentOptions) {
    super(options);
    this.environmentOptions = options.environmentOptions;
    this.mountPaths = options.mountPaths ?? [];
    this.mountMappings = options.mountMappings ?? [];
    this.indexMountedFiles = options.indexMountedFiles ?? false;
    this.mountReadonly = options.mountReadonly ?? false;
    this.outputDir = options.outputDir;
    this.aiMaxIterations = options.aiMaxIterations ?? 10;
  }

  /**
   * Validate pyodide-specific configuration
   */
  override validate(): void {
    // Call base validation first
    super.validate();

    // Validate pyodide-specific options
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

/**
 * Parse pyodide-specific command-line arguments
 */
export function parsePyodideRuntimeArgs(
  args: string[],
): Partial<PyodideRuntimeAgentOptions> {
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
    console.log(`
Pyodide Runtime Agent Configuration

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
                             (default: "python3-pyodide")
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
  --runtime-python-path <path>     Path to Python executable (default: "python3")
  --runtime-env-path <path>        Path to virtual environment
  --runtime-package-manager <mgr>  Package manager to use (default: "pip")
  --runtime-env-externally-managed Treat environment as externally managed
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

Python Environment Configuration:
  RUNTIME_PYTHON_PATH            Path to Python executable (default: "python3")
  RUNTIME_ENV_PATH               Path to virtual environment
  RUNTIME_PACKAGE_MANAGER        Package manager (default: "pip")
  RUNTIME_ENV_EXTERNALLY_MANAGED Set to "true" for externally managed envs

OpenAI Embedding Configuration (for --index-mounted-files):
  OPENAI_EMBEDDING_API_KEY       OpenAI API key for optimal vector store embeddings
  OPENAI_EMBEDDING_MODEL         OpenAI embedding model (default: text-embedding-3-large)

AI Configuration:
  AI_MAX_ITERATIONS              Maximum AI tool calling iterations (default: 10)

Logging Configuration:
  RUNT_LOG_LEVEL                 Set to DEBUG, INFO, WARN, or ERROR (default: INFO)
  RUNT_DISABLE_CONSOLE_LOGS      Set to disable console output
    `);
    Deno.exit(0);
  }

  // Start with base parsing
  let result = parseBaseRuntimeArgs(args) as Partial<
    PyodideRuntimeAgentOptions
  >;

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

  // Handle Python environment options
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
 * Create a complete pyodide runtime configuration from CLI args and defaults
 */
export function createPyodideRuntimeConfig(
  args: string[],
  defaults: Partial<PyodideRuntimeAgentOptions> = {},
): PyodideRuntimeConfig {
  const cliConfig = parsePyodideRuntimeArgs(args);

  // Merge CLI config with defaults - CLI args override defaults
  const mergedDefaults: Partial<PyodideRuntimeAgentOptions> = {
    runtimeType: "python3-pyodide",
    syncUrl: DEFAULT_CONFIG.syncUrl,
    capabilities: {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: true,
      availableAiModels: [], // Will be populated during startup
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
  const cleanCliConfig: Partial<PyodideRuntimeAgentOptions> = Object
    .fromEntries(
      Object.entries(cliConfig).filter(([_, value]) => value !== undefined),
    );

  // Compose the config object
  const runtimeId = cleanCliConfig.runtimeId ||
    Deno.env.get("RUNTIME_ID") ||
    `${
      cleanCliConfig.runtimeType || mergedDefaults.runtimeType
    }-runtime-${Deno.pid}`;

  const config: PyodideRuntimeAgentOptions = {
    ...mergedDefaults,
    ...cleanCliConfig,
    runtimeId,
    environmentOptions: {
      ...mergedDefaults.environmentOptions,
      ...(cleanCliConfig.environmentOptions ?? {}),
    },
  } as PyodideRuntimeAgentOptions;

  const runtimeConfig = new PyodideRuntimeConfig(config);
  runtimeConfig.validate();

  logger.debug("Pyodide runtime configuration created", {
    runtimeType: runtimeConfig.runtimeType,
    runtimeId: runtimeConfig.runtimeId,
    syncUrl: runtimeConfig.syncUrl,
    notebookId: runtimeConfig.notebookId,
    sessionId: runtimeConfig.sessionId,
    environmentOptions: config.environmentOptions,
    mountPaths: runtimeConfig.mountPaths,
    mountMappings: runtimeConfig.mountMappings,
    indexMountedFiles: runtimeConfig.indexMountedFiles,
    aiMaxIterations: runtimeConfig.aiMaxIterations,
  });

  return runtimeConfig;
}

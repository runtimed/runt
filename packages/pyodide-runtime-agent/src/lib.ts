// Main exports for @runt/pyodide-runtime-agent
//
// This module exports the enhanced Pyodide-specific runtime agent for building
// Python runtime agents that integrate with the @runt/lib framework
// and use web workers with rich display support and true interrupt support.

export { PyodideRuntimeAgent } from "./pyodide-agent.ts";

// Export cache utilities for advanced package management
export {
  getCacheConfig,
  getCacheDir,
  getEssentialPackages,
  getOnDemandPackages,
  getPreloadPackages,
} from "./cache-utils.ts";

// Re-export useful types from @runt/lib for convenience
export type {
  CancellationHandler,
  ExecutionContext,
  ExecutionHandler,
  ExecutionResult,
  RuntimeAgentEventHandlers,
} from "@runt/lib";

// Main execution when run directly
if (import.meta.main) {
  const { PyodideRuntimeAgent } = await import("./pyodide-agent.ts");
  const { createLogger } = await import("@runt/lib");

  const agent = new PyodideRuntimeAgent();
  const logger = createLogger("pyodide-main");

  try {
    await agent.start();

    logger.info("Pyodide runtime agent started", {
      kernelId: agent.config.kernelId,
      kernelType: agent.config.kernelType,
      notebookId: agent.config.notebookId,
    });

    // Keep the process running
    await new Promise(() => {});
  } catch (error) {
    logger.error("Failed to start Pyodide runtime agent", { error });
    Deno.exit(1);
  }
}

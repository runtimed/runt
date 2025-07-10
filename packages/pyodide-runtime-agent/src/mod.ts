#!/usr/bin/env -S deno run --allow-all --unstable-broadcast-channel
/**
 * PyRunt - Python Runtime Agent
 *
 * Main executable entry point for the Pyodide runtime agent.
 * This file serves as both the library entry point and the executable.
 */

import { PyodideRuntimeAgent } from "./pyodide-agent.ts";
import { createLogger } from "@runt/lib";
import { initializeTTYDisplay } from "./tty-display.ts";

export { PyodideRuntimeAgent } from "./pyodide-agent.ts";
export {
  getBootstrapPackages,
  getCacheConfig,
  getCacheDir,
  getEssentialPackages,
  getOnDemandPackages,
  getPreloadPackages,
  isFirstRun,
} from "./cache-utils.ts";
export {
  getTTYDisplay,
  initializeTTYDisplay,
  type StatusUpdate,
  TTYDisplay,
} from "./tty-display.ts";

/**
 * Main function to run the Pyodide runtime agent
 */
async function main() {
  const display = initializeTTYDisplay();
  const agent = new PyodideRuntimeAgent();
  const logger = createLogger("pyrunt");

  try {
    display.setStartupPhase("Initializing runtime agent...", 10);

    display.setStartupPhase("Starting PyRunt...", 50);
    await agent.start();

    display.setStartupPhase("Runtime started successfully", 100);

    logger.info("PyRunt started", {
      runtimeId: agent.config.runtimeId,
      runtimeType: agent.config.runtimeType,
      notebookId: agent.config.notebookId,
      sessionId: agent.config.sessionId,
      syncUrl: agent.config.syncUrl,
    });

    display.setReady();
    await agent.keepAlive();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    display.setError("Failed to start PyRunt", errorMessage);
    logger.error("Failed to start PyRunt", error);
    Deno.exit(1);
  } finally {
    display.stop();
    await agent.shutdown();
  }
}

// Run as script if this file is executed directly
if (import.meta.main) {
  await main();
}

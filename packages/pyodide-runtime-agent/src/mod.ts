#!/usr/bin/env -S deno run --allow-all --unstable-broadcast-channel
/**
 * PyRunt - Python Runtime Agent
 *
 * Main executable entry point for the Pyodide runtime agent.
 * This file serves as both the library entry point and the executable.
 */

import { PyodideRuntimeAgent } from "./pyodide-agent.ts";
import { createLogger } from "@runt/lib";

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

/**
 * Main function to run the Pyodide runtime agent
 */
async function main() {
  const agent = new PyodideRuntimeAgent();
  const logger = createLogger("pyrunt");

  try {
    await agent.start();

    logger.info("PyRunt started", {
      runtimeId: agent.config.runtimeId,
      runtimeType: agent.config.runtimeType,
      notebookId: agent.config.notebookId,
      sessionId: agent.config.sessionId,
      syncUrl: agent.config.syncUrl,
    });

    await agent.keepAlive();
  } catch (error) {
    logger.error("Failed to start PyRunt", error);
    Deno.exit(1);
  } finally {
    await agent.shutdown();
  }
}

// Run as script if this file is executed directly
if (import.meta.main) {
  await main();
}

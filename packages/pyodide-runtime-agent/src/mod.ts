#!/usr/bin/env -S deno run --allow-all --unstable-broadcast-channel
/**
 * PyoRunt - Python Runtime Agent
 *
 * Main executable entry point for the Pyodide runtime agent.
 * This file serves as both the library entry point and the executable.
 */

import { PyodideRuntimeAgent } from "./pyodide-agent.ts";
export { PyodideRuntimeAgent } from "./pyodide-agent.ts";
import { createLogger } from "@runt/lib";

// Run the agent if this file is executed directly
if (import.meta.main) {
  const name = "PyoRunt";
  const logger = createLogger(name);

  const agent = new PyodideRuntimeAgent();

  logger.info("Starting Agent");

  try {
    await agent.start();

    logger.info(`${name} started`, {
      runtimeId: agent.config.runtimeId,
      runtimeType: agent.config.runtimeType,
      notebookId: agent.config.notebookId,
      sessionId: agent.config.sessionId,
      syncUrl: agent.config.syncUrl,
    });

    await agent.keepAlive();
  } catch (error) {
    logger.error(`${name} failed to start`, error);
    Deno.exit(1);
  }

  agent.shutdown().catch((error) => {
    logger.error(`${name} failed to shutdown`, error);
    Deno.exit(1);
  });
  Deno.exit(0);
}

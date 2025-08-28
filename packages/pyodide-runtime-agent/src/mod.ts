#!/usr/bin/env -S deno run --allow-all --unstable-broadcast-channel
/**
 * PyoRunt - Python Runtime Agent
 *
 * Main executable entry point for the Pyodide runtime agent.
 * This file serves as both the library entry point and the executable.
 */

import { PyodideRuntimeAgent } from "./pyodide-agent.ts";
export { PyodideRuntimeAgent } from "./pyodide-agent.ts";
import {
  createLogger,
  createRuntimeConfig,
  discoverUserIdentity,
} from "@runt/lib";

// Run the agent if this file is executed directly
if (import.meta.main) {
  const name = "PyoRunt";
  const logger = createLogger(name);

  logger.info("Authenticating...");

  // Create temporary config to get auth details
  const tempConfig = createRuntimeConfig(Deno.args, {
    runtimeType: "python3-pyodide",
    capabilities: {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: true,
      availableAiModels: [],
    },
    clientId: "temp", // Will be replaced
  });

  // Discover user identity first
  const clientId = await discoverUserIdentity({
    authToken: tempConfig.authToken,
    syncUrl: tempConfig.syncUrl,
  });

  logger.info("Authenticated successfully", { clientId });

  // Create agent with discovered clientId
  const agent = new PyodideRuntimeAgent(
    Deno.args,
    {}, // pyodide options
    { clientId }, // runtime options
  );

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

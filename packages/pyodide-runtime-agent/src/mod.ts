#!/usr/bin/env -S deno run --allow-all --unstable-broadcast-channel
/**
 * PyoRunt - Python Runtime Agent
 *
 * Main executable entry point for the Pyodide runtime agent.
 * This file serves as both the library entry point and the executable.
 */

import { PyodideRuntimeAgent } from "./pyodide-agent.ts";
export { PyodideRuntimeAgent } from "./pyodide-agent.ts";
import { logger, LogLevel } from "@runt/lib";
import { discoverUserIdentity } from "./auth.ts";
import { createPyodideRuntimeConfig } from "./pyodide-config.ts";
import { makeAdapter } from "npm:@livestore/adapter-node";
import { makeCfSync } from "npm:@livestore/sync-cf";

// Run the agent if this file is executed directly
if (import.meta.main) {
  const name = "PyoRunt";

  // Configure logger early based on environment variables for CLI usage
  const runtLogLevel = Deno.env.get("RUNT_LOG_LEVEL");
  const disableConsole = Deno.env.get("RUNT_DISABLE_CONSOLE_LOGS") === "true";

  if (runtLogLevel) {
    const normalizedLevel = runtLogLevel.toUpperCase();
    let logLevel: LogLevel;
    switch (normalizedLevel) {
      case "DEBUG":
        logLevel = LogLevel.DEBUG;
        break;
      case "INFO":
        logLevel = LogLevel.INFO;
        break;
      case "WARN":
      case "WARNING":
        logLevel = LogLevel.WARN;
        break;
      case "ERROR":
        logLevel = LogLevel.ERROR;
        break;
      default:
        logLevel = LogLevel.ERROR;
    }

    logger.configure({
      level: logLevel,
      console: !disableConsole,
    });
  }

  logger.info("Authenticating...");

  // Create temporary config to get auth details
  const tempConfig = createPyodideRuntimeConfig(Deno.args, {
    clientId: "temp", // Will be replaced
  });

  // Discover user identity first
  const clientId = await discoverUserIdentity({
    authToken: tempConfig.authToken,
    syncUrl: tempConfig.syncUrl,
  });

  logger.info("Authenticated successfully", { clientId });

  // Create adapter for Node.js environment with Cloudflare sync
  const adapter = makeAdapter({
    storage: { type: "in-memory" },
    sync: {
      backend: makeCfSync({ url: tempConfig.syncUrl }),
      onSyncError: "ignore",
    },
  });

  // Create agent with discovered clientId and Node.js adapter
  const agent = new PyodideRuntimeAgent(
    Deno.args,
    {}, // pyodide options
    { clientId, adapter }, // runtime options
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

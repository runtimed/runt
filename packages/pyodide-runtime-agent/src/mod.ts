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
  createRuntimeSyncPayload,
  createStorePromise,
  logger,
  LogLevel,
} from "@runtimed/agent-core";
import type { CreateStoreConfig } from "@runtimed/agent-core";
import { discoverUserIdentity } from "./auth.ts";
import { parseBaseRuntimeArgs } from "./config-cli.ts";
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
    let logLevel: typeof LogLevel[keyof typeof LogLevel];
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
        logLevel = LogLevel.INFO;
    }

    logger.configure({
      level: logLevel,
      console: !disableConsole,
    });
  } else {
    // Configure with INFO as default when no RUNT_LOG_LEVEL is set
    logger.configure({
      level: LogLevel.INFO,
      console: !disableConsole,
    });
  }

  logger.info("Authenticating...");

  // Parse CLI args once to get auth details
  const cliConfig = parseBaseRuntimeArgs(Deno.args);
  const syncUrl = cliConfig.syncUrl ||
    "wss://app.runt.run";
  const authToken = cliConfig.authToken;

  if (!authToken) {
    console.error("❌ Configuration Error: Missing auth token");
    console.error("Use --auth-token or set RUNT_API_KEY environment variable");
    Deno.exit(1);
  }

  // Discover user identity - LiveStore will handle clientId internally
  const { userId, userInfo } = await discoverUserIdentity({
    authToken,
    syncUrl,
  });

  logger.info("Authenticated successfully", {
    userId,
    email: userInfo.email,
  });

  // Create adapter for Node.js environment with Cloudflare sync
  const adapter = makeAdapter({
    storage: { type: "in-memory" },
    sync: {
      backend: makeCfSync({ url: syncUrl }),
      onSyncError: "ignore",
    },
  });

  // Create sync payload for runtime
  const syncPayload = createRuntimeSyncPayload({
    authToken,
    runtimeId: `python3-pyodide-runtime-${Deno.pid}`,
    sessionId: crypto.randomUUID(),
    userId,
  });

  // Get notebook ID with proper error handling
  let notebookId: string;
  if (Deno.args.includes("--notebook")) {
    const notebookIndex = Deno.args.indexOf("--notebook");
    const notebookValue = Deno.args[notebookIndex + 1];
    if (!notebookValue || notebookValue.startsWith("-")) {
      console.error("❌ --notebook flag requires a notebook ID value");
      Deno.exit(1);
    }
    notebookId = notebookValue;
  } else {
    notebookId = Deno.env.get("NOTEBOOK_ID") || "";
    if (!notebookId) {
      console.error(
        "❌ Notebook ID is required. Set NOTEBOOK_ID environment variable or use --notebook flag",
      );
      Deno.exit(1);
    }
  }

  // Create store configuration
  const storeConfig: CreateStoreConfig = {
    adapter,
    notebookId,
    syncPayload,
  };

  // Create the store
  logger.info("Creating LiveStore instance...");
  const store = await createStorePromise(storeConfig);
  logger.info("LiveStore instance created successfully");

  // Create agent with store
  const agent = new PyodideRuntimeAgent(
    Deno.args,
    {}, // pyodide options
    { store, userId }, // runtime options
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

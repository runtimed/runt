#!/usr/bin/env -S deno run --allow-net --allow-env

// Echo Agent - Basic runtime agent example

import { createLogger, createRuntimeConfig, RuntimeAgent } from "@runt/lib";

const logger = createLogger("echo-agent");

// Create configuration from CLI arguments and environment variables
let config;
try {
  config = createRuntimeConfig(Deno.args, {
    runtimeType: "echo",
    capabilities: {
      canExecuteCode: true,
      canExecuteSql: false,
      canExecuteAi: true,
    },
  });
} catch (error) {
  console.error("❌ Configuration Error:");
  console.error(error instanceof Error ? error.message : String(error));
  console.error("\nExample usage:");
  console.error(
    "  deno run --allow-all --env-file=.env echo-agent.ts --notebook my-notebook --auth-token your-token",
  );
  console.error("\nOr set environment variables:");
  console.error("  NOTEBOOK_ID=my-notebook");
  console.error("  AUTH_TOKEN=your-token");
  Deno.exit(1);
}

// Create the runtime agent
const agent = new RuntimeAgent(config, config.capabilities, {
  onStartup: () => logger.info("Echo agent starting"),
  onConnected: () => logger.info("Connected to LiveStore"),
  onShutdown: () => logger.info("Echo agent shutting down"),
  onExecutionError: (error, context) => {
    logger.error("Execution error", error, { cellId: context.cell.id });
  },
});

// Register the execution handler
agent.onExecution(async (context) => {
  const { cell } = context;
  await new Promise((resolve) => setTimeout(resolve, 0));

  logger.debug("Executing cell", { cellType: cell.cellType, cellId: cell.id });

  if (cell.cellType === "ai") {
    // AI cell: respond with bot message
    return {
      success: true,
      data: {
        "text/plain": `🤖 AI Response: "${cell.source || ""}"`,
      },
    };
  } else {
    // Code cell: echo the input
    return {
      success: true,
      data: {
        "text/plain": `Echo: ${cell.source || ""}`,
      },
    };
  }
});

// Start the agent
try {
  await agent.start();

  logger.info("Echo agent started", {
    runtimeId: config.runtimeId,
    runtimeType: config.runtimeType,
    notebookId: config.notebookId,
    sessionId: config.sessionId,
  });

  await agent.keepAlive();
} catch (error) {
  logger.error("Failed to start echo agent", error);
  Deno.exit(1);
}

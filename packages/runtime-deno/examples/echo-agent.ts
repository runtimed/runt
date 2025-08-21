#!/usr/bin/env -S deno run --allow-net --allow-env

// Echo Agent - Basic runtime agent example

import {
  createLogger,
  createRuntimeConfig,
  createStoreFromConfig,
  runner,
  RuntimeAgent,
} from "@runt/runtime-deno";

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
    "  deno run --allow-all --env-file=.env echo-agent.ts --notebook my-notebook --auth-token your-runt-api-key",
  );
  console.error("\nOr set environment variables:");
  console.error("  NOTEBOOK_ID=my-notebook");
  console.error("  RUNT_API_KEY=your-runt-api-key");
  Deno.exit(1);
}

// Create LiveStore from configuration
let store;
try {
  store = await createStoreFromConfig(config);
} catch (error) {
  console.error("❌ Store Creation Error:");
  console.error(error instanceof Error ? error.message : String(error));
  Deno.exit(1);
}

// Create the runtime agent
const agent = new RuntimeAgent(
  store,
  config.capabilities,
  {
    runtimeId: config.runtimeId,
    runtimeType: config.runtimeType,
    clientId: config.runtimeId, // Use runtimeId as clientId for now
    sessionId: config.sessionId,
  },
  {
    onStartup: () => logger.info("Echo agent starting"),
    onConnected: () => logger.info("Connected to LiveStore"),
    onShutdown: () => logger.info("Echo agent shutting down"),
    onExecutionError: (error: Error, context) => {
      logger.error("Execution error", error, { cellId: context.cell.id });
    },
  },
);

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

// Start the agent using the runner helper
await runner(agent, "echo-agent");

#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write --allow-sys --quiet
import React from "react";
import { render, useStdin } from "ink";
import { Effect, Logger, LogLevel } from "effect";
import meow from "meow";
import App from "./app.tsx";
import { createSimpleTUILogger } from "./utils/simpleLogging.ts";

const cli = meow(
  `
	Usage
	  $ runt tui

	Options
		--notebook Notebook ID to render
		--log      Use structured logging instead of TUI (default: false)

	Key Bindings
		↑/↓        Navigate between cells
		L          Toggle debug logs visibility
		Ctrl+C     Exit (press twice to force quit)

	Examples
	  $ runt tui --notebook=my-notebook-id
	  Rendering notebook: my-notebook-id
	  $ runt tui --log
	  Use structured logging output
`,
  {
    importMeta: import.meta,
    flags: {
      notebook: {
        type: "string",
      },
      log: {
        type: "boolean",
        default: false,
      },
    },
  },
);

// Clear terminal and suppress warnings for clean display
console.clear();

// Setup Effect logger globally once
const logger = Logger.make(createSimpleTUILogger().log);
const loggerLayer = Logger.replace(Logger.defaultLogger, logger);

// Apply global logger and log initialization
Effect.runFork(
  Effect.log("TUI logger initialized").pipe(
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.provide(loggerLayer),
  ),
);

// If --log flag is provided, use structured logging
if (cli.flags.log) {
  console.log("Starting runt with structured logging...");
  Deno.exit(0);
}

// Component to check raw mode support using Ink's built-in detection
const RawModeChecker: React.FC<{ children: React.ReactNode }> = (
  { children },
) => {
  const { isRawModeSupported } = useStdin();

  if (!isRawModeSupported) {
    console.error(
      "Error: Raw mode is not supported in this environment.",
    );
    console.error("This usually happens when:");
    console.error("  - Running in non-interactive mode (pipes, redirects)");
    console.error("  - Running in certain CI/CD environments");
    console.error("  - Terminal doesn't support raw mode operations");
    console.error("");
    console.error(
      "Try running in a proper terminal or use --log flag for non-interactive output.",
    );
    Deno.exit(1);
  }

  return <>{children}</>;
};

// Default: Start TUI experience
let waitUntilExit: () => Promise<void>;

try {
  ({ waitUntilExit } = render(
    <RawModeChecker>
      <App notebook={cli.flags.notebook} />
    </RawModeChecker>,
  ));
} catch (error) {
  console.error("Failed to start TUI:", error.message);
  console.error("This could be due to:");
  console.error("  - Terminal compatibility issues");
  console.error("  - Missing terminal capabilities");
  console.error("  - Environment configuration problems");
  console.error("");
  console.error("Try using --log flag for non-interactive output.");
  Deno.exit(1);
}

// Handle graceful shutdown on process signals
const handleExit = (signal: string) => {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  Deno.exit(0);
};

// Register signal handlers
Deno.addSignalListener("SIGINT", () => handleExit("SIGINT"));
Deno.addSignalListener("SIGTERM", () => handleExit("SIGTERM"));

// Handle uncaught exceptions
globalThis.addEventListener("error", (event) => {
  console.error("Uncaught Exception:", event.error);
  Deno.exit(1);
});

globalThis.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled Rejection:", event.reason);
  Deno.exit(1);
});

// Wait for the app to exit
try {
  await waitUntilExit();
} catch (error) {
  console.error("TUI runtime error:", error.message || error);

  // Provide specific guidance based on error type
  if (error.message?.includes("Raw mode")) {
    console.error("This is a terminal compatibility issue.");
    console.error("Try running in a different terminal or use --log flag.");
  } else if (error.message?.includes("EPIPE")) {
    console.error("Output pipe was closed unexpectedly.");
  } else if (error.message?.includes("ENOTTY")) {
    console.error("Not running in a proper terminal (TTY).");
    console.error("Use --log flag for non-interactive environments.");
  } else {
    console.error("This may be due to terminal or environment issues.");
    console.error("Try using --log flag for non-interactive output.");
  }

  Deno.exit(1);
}

# @runt/runtime-deno

Deno platform adapter for building runtime agents that connect to Anode
notebooks. This package provides Deno-specific utilities for CLI configuration,
lifecycle management, and LiveStore integration.

## Features

- **Store-First Architecture**: Integrates with LiveStore for real-time
  collaboration
- **CLI Configuration**: Parse command-line arguments and environment variables
- **Lifecycle Management**: Handle startup, shutdown, and signal handling
- **Type-Safe**: Full TypeScript support with proper typing
- **Deno Optimized**: Built specifically for Deno runtime

## Migration from @runt/runtime-node

> **Note**: This package was renamed from `@runt/runtime-node` to
> `@runt/runtime-deno` in version 0.12.0 to better reflect its purpose as a
> Deno-specific runtime adapter.
>
> **Migration**: Simply update your imports from `@runt/runtime-node` to
> `@runt/runtime-deno`. All APIs remain the same.

## Installation

```bash
deno add @runt/runtime-deno
```

Or use directly from JSR:

```typescript
import { createRuntimeConfig, runner } from "jsr:@runt/runtime-deno@^0.12.0";
```

## Basic Usage

### Store-First Runtime Agent

```typescript
import {
  createStorePromise,
  makeSchema,
  State,
} from "npm:@livestore/livestore";
import { makeAdapter } from "npm:@livestore/adapter-node";
import { events, materializers, tables } from "@runt/schema";
import { RuntimeAgent } from "@runt/runtime-core";
import { createRuntimeConfig } from "@runt/runtime-deno";

// Create LiveStore schema
const schema = makeSchema({
  events,
  state: State.SQLite.makeState({ tables, materializers }),
});

// Parse CLI configuration
const config = createRuntimeConfig(Deno.args, {
  runtimeType: "my-deno-runtime",
  capabilities: {
    canExecuteCode: true,
    canExecuteSql: false,
    canExecuteAi: false,
  },
});

// Create store instance
const store = await createStorePromise({
  adapter: makeAdapter({ storage: { type: "sqlite", path: ":memory:" } }),
  schema,
  storeId: "my-runtime-store",
  syncPayload: {
    authToken: config.authToken,
    clientId: "my-client",
  },
});

// Create runtime agent with store-first pattern
const agent = new RuntimeAgent(
  store,
  config.capabilities,
  {
    runtimeId: config.runtimeId,
    runtimeType: config.runtimeType,
    clientId: "my-client",
  },
);

// Register execution handler
agent.onExecution(async (context) => {
  const { cell } = context;

  // Your execution logic here
  context.stdout("Processing...\n");

  context.result({
    "text/plain": `Executed: ${cell.source}`,
    "application/json": { success: true },
  });

  return { success: true };
});

// Start the agent
await agent.start();
await agent.keepAlive();
```

### Using the Runner Helper

For simple CLI applications, use the `runner` utility:

```typescript
import { runner } from "@runt/runtime-deno";
import { RuntimeAgent } from "@runt/runtime-core";

// Create your agent (using store-first pattern as shown above)
const agent = new RuntimeAgent(/* ... */);

agent.onExecution(async (context) => {
  // Your execution logic
  return { success: true };
});

// Use runner for lifecycle management
await runner(agent, "My Runtime Agent");
```

## CLI Configuration

### Command Line Arguments

```bash
--notebook <id>              # Notebook ID (required)
--auth-token <token>         # Authentication token (required) 
--sync-url <url>             # LiveStore sync URL (optional)
--runtime-type <type>        # Runtime type identifier (optional)
--runtime-id <id>            # Unique runtime instance ID (optional)
--heartbeat-interval <ms>    # Heartbeat interval (optional)
```

### Environment Variables

- `NOTEBOOK_ID` - Notebook to connect to
- `RUNT_API_KEY` or `AUTH_TOKEN` - Authentication token
- `LIVESTORE_SYNC_URL` - LiveStore sync server URL
- `RUNTIME_ID` - Unique runtime identifier
- `RUNT_LOG_LEVEL` - Logging level (DEBUG, INFO, WARN, ERROR)
- `RUNT_DISABLE_CONSOLE_LOGS` - Disable console output

### Configuration Defaults

```typescript
import { createRuntimeConfig } from "@runt/runtime-deno";

const config = createRuntimeConfig(Deno.args, {
  runtimeType: "my-runtime",
  capabilities: {
    canExecuteCode: true,
    canExecuteSql: false,
    canExecuteAi: false,
  },
  environmentOptions: {
    runtimePythonPath: "python3",
    runtimePackageManager: "pip",
  },
});
```

## Execution Context

The execution context provides methods for outputting different types of
content:

```typescript
agent.onExecution(async (context) => {
  const { cell } = context;

  // Stream text output
  context.stdout("Processing data...\n");
  context.stderr("Warning: deprecated API\n");

  // Rich display data (multiple formats)
  context.display({
    "text/html": "<h1>Results</h1><p>Data processed successfully</p>",
    "text/plain": "Results: Data processed successfully",
    "application/json": { status: "complete", rows: 42 },
  });

  // Set final cell result
  context.result({
    "text/plain": "Execution complete",
    "application/json": { success: true, timestamp: Date.now() },
  });

  // Handle errors
  try {
    // Your code here
  } catch (error) {
    context.error("RuntimeError", error.message, [error.stack]);
    return { success: false };
  }

  // Clear previous outputs
  context.clear();

  return { success: true };
});
```

## Advanced Usage

### Custom Capabilities

```typescript
const config = createRuntimeConfig(Deno.args, {
  runtimeType: "advanced-runtime",
  capabilities: {
    canExecuteCode: true,
    canExecuteSql: true, // Enable SQL execution
    canExecuteAi: true, // Enable AI integration
  },
});
```

### Environment Options

```typescript
const config = createRuntimeConfig(Deno.args, {
  environmentOptions: {
    runtimePythonPath: "/usr/bin/python3.11",
    runtimePackageManager: "uv",
    runtimeEnvExternallyManaged: true,
  },
});
```

## Testing

```bash
# Run all tests
deno task test

# Run specific test suites
deno task test:unit
deno task test:integration

# Watch mode
deno task test:watch

# Type checking
deno task check
```

## Logging

```typescript
import { createLogger } from "@runt/runtime-core";

const logger = createLogger("my-deno-runtime", {
  context: {
    runtimeId: "my-runtime-123",
    sessionId: "session-456",
  },
});

logger.info("Runtime started");
logger.error("Execution failed", { cellId: "cell-123" });
```

### Log Levels

Set via environment variables:

- `RUNT_LOG_LEVEL=DEBUG` - Detailed debugging information
- `RUNT_LOG_LEVEL=INFO` - General information (default)
- `RUNT_LOG_LEVEL=WARN` - Warning messages only
- `RUNT_LOG_LEVEL=ERROR` - Error messages only
- `RUNT_DISABLE_CONSOLE_LOGS=true` - Disable console output

## Architecture

This package is part of the Runt runtime agent ecosystem:

- **@runt/schema** - Event sourcing schema and types
- **@runt/runtime-core** - Platform-agnostic runtime agent core
- **@runt/runtime-deno** - Deno-specific platform adapter (this package)
- **@runt/runtime-browser** - Browser-specific platform adapter

The store-first architecture ensures that:

- LiveStore handles state management and real-time sync
- Runtime agents focus on execution logic
- Multiple clients can collaborate in real-time
- State is consistent across all connected clients

## License

BSD-3-Clause

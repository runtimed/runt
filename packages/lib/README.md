# @runt/lib

Runtime agent base class for connecting to Anode notebooks.

## Usage

```typescript
import { createRuntimeConfig, RuntimeAgent } from "@runt/lib";

const config = createRuntimeConfig(Deno.args, {
  runtimeType: "my-runtime",
  capabilities: {
    canExecuteCode: true,
    canExecuteSql: false,
    canExecuteAi: false,
  },
});

const agent = new RuntimeAgent(config, config.capabilities);

agent.onExecution(async (context) => {
  const { cell } = context;

  // Your execution logic here
  return {
    success: true,
    data: { "text/plain": `Result: ${cell.source}` },
  };
});

await agent.start();
await agent.keepAlive();
```

## CLI Arguments

```bash
--notebook <id>           # Required
--auth-token <token>      # Required
--runtime-type <type>     # Optional
--sync-url <url>          # Optional
```

Environment variables: `NOTEBOOK_ID`, `AUTH_TOKEN`, `RUNTIME_TYPE`,
`LIVESTORE_SYNC_URL`.

## Outputs

```typescript
agent.onExecution(async (context) => {
  // Stream text output
  context.stdout("Processing...\n");
  context.stderr("Warning: deprecated\n");

  // Rich display data
  context.display({
    "text/html": "<h1>Results</h1>",
    "text/plain": "Results",
  });

  // Final result
  context.result({
    "text/plain": "Done",
  });

  // Error handling
  context.error("ValueError", "Bad input", ["Traceback..."]);

  // Clear previous outputs
  context.clear();

  return { success: true };
});
```

The library handles LiveStore connection, execution queues, and CLI
configuration. You implement the execution handler and emit outputs via context
methods.

## Testing

```bash
deno task test
deno task test:unit
deno task test:integration
deno task test:watch
```

## Logging

```typescript
import { createLogger } from "@runt/lib";
const logger = createLogger("my-agent");
```

Environment variables: `RUNT_LOG_LEVEL`, `RUNT_DISABLE_CONSOLE_LOGS`. Default
log level is `ERROR`.

# @runt/lib

Runtime agent base class. Connects to [Anode](https://github.com/rgbkrk/anode),
processes execution queues, handles outputs.

## Usage

```typescript
import { createRuntimeConfig, RuntimeAgent } from "@runt/lib";

const config = createRuntimeConfig(Deno.args, {
  kernelType: "my-kernel",
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
--kernel-type <type>      # Optional
--sync-url <url>          # Optional
```

Environment variables: `NOTEBOOK_ID`, `AUTH_TOKEN`, `KERNEL_TYPE`,
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

What it does:

- LiveStore connection and kernel session management
- Execution queue processing
- Heartbeats and shutdown
- CLI configuration

What you do:

- Implement execution handler
- Emit outputs via context methods

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

Environment: `RUNT_LOG_LEVEL`, `RUNT_DISABLE_CONSOLE_LOGS`

The default log level is `ERROR`. Set `RUNT_LOG_LEVEL` to `INFO` or `DEBUG` for
more verbose output. Continuous integration runs use `RUNT_LOG_LEVEL=INFO` so
you'll see detailed logs in CI.

Examples in `examples/`.

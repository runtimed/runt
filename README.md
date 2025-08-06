# Runt

Runtime agents for connecting to
[Anode notebooks](https://github.com/rgbkrk/anode) with real-time collaboration,
rich output support, and AI integration.

## Features

- **🐍 Python Runtime**: Full Python execution via Pyodide with scientific
  computing stack
- **🤖 AI Integration**: OpenAI and Ollama support with tool calling and
  streaming responses
- **📊 Rich Outputs**: Matplotlib plots, pandas tables, HTML, and custom display
  formats
- **🔄 Real-time Sync**: LiveStore-based collaboration with conflict-free
  merging
- **💻 Terminal UI**: Cell-based notebook viewer with vim-like navigation
- **⚡ Streaming**: Live output streaming with granular event types
- **🛠️ Extensible**: Plugin architecture for custom runtime implementations

## Packages

| Package                                                          | Description                                 | Status       |
| ---------------------------------------------------------------- | ------------------------------------------- | ------------ |
| [`@runt/schema`](packages/schema/)                               | LiveStore schema (events, tables, types)    | ✅ Stable    |
| [`@runt/lib`](packages/lib/)                                     | Runtime agent base class                    | ✅ Stable    |
| [`@runt/pyodide-runtime-agent`](packages/pyodide-runtime-agent/) | Python runtime using Pyodide                | ✅ Working   |
| [`@runt/ai`](packages/ai/)                                       | OpenAI and Ollama clients with tool calling | ✅ Working   |
| [`@runt/tui`](packages/tui/)                                     | Terminal notebook viewer                    | ✅ Working   |
| [`@runt/python-runtime-agent`](packages/python-runtime-agent/)   | Native Python runtime                       | 🚧 Stub only |

## Quick Start

### Install Global Executable

```bash
# Install Pyodide-based Python runtime
deno install --global --allow-all --name pyrunt jsr:@runt/pyodide-runtime-agent

# Run with a notebook ID from Anode
pyrunt --notebook YOUR_NOTEBOOK_ID --auth-token YOUR_TOKEN
```

### Development

```bash
# Run all checks (lint, format, type-check, test)
deno task ci

# Run tests only
deno task test

# Run example agent  
deno task dev
```

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Anode Web     │◄──►│   LiveStore      │◄──►│  Runtime Agent  │
│   Notebook      │    │   Sync Server    │    │  (Python/AI)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                        ┌───────▼────────┐
                        │  Terminal UI   │
                        │  (Optional)    │
                        └────────────────┘
```

- **LiveStore**: Event-sourcing framework for local-first apps with real-time
  sync
- **Runtime Agents**: Execute code, handle AI requests, stream outputs
- **Anode Notebooks**: Web-based notebook interface with collaborative editing
- **Terminal UI**: Optional cell-based viewer for headless environments

## Core Concepts

### Event-Sourced State

All notebook state is managed through immutable events:

```typescript
import { createCellBetween } from "@runt/schema";

// Create cells with conflict-free ordering
const event = createCellBetween(
  { id: "cell-1", cellType: "code", createdBy: "runtime" },
  cellBefore, // null for first cell
  cellAfter, // null for last cell
);
store.commit(event);
```

### Streaming Outputs

Runtime agents emit granular events for rich display:

```typescript
context.stdout("Processing data...\n");
context.display({ "text/html": "<h1>Results</h1>" });
context.result({ "application/json": results });
```

### AI Integration

Built-in support for OpenAI and Ollama with tool calling:

```typescript
import { OpenAIClient, RuntOllamaClient } from "@runt/ai";

await client.generateAgenticResponse(messages, context, {
  model: "gpt-4", // or "llama3.1"
  enableTools: true,
  onToolCall: handleNotebookTool,
});
```

## File Structure

```
packages/
├── schema/                   # LiveStore schema definitions
├── lib/                      # Runtime agent base class
├── pyodide-runtime-agent/    # Python runtime implementation
├── ai/                       # OpenAI and Ollama clients
├── tui/                      # Terminal notebook viewer
└── python-runtime-agent/     # Stub for native Python runtime
```

## Examples

Working examples in [`packages/lib/examples/`](packages/lib/examples/):

- **Echo Agent**: Simple text processing
- **Streaming Demo**: Output streaming patterns
- **AI Integration**: Tool calling and agentic behavior

## Testing

Run the full test suite with proper permissions:

```bash
deno test --allow-env --allow-net --allow-read --allow-write --allow-sys
```

Tests include unit tests, integration tests, and example validation across all
packages.

## Key Constraints

- **LiveStore Materializers**: Must be pure functions - no `Date()` or
  `Math.random()`
- **Session Management**: Each runtime restart gets unique `sessionId`
- **Cell Creation**: Use `createCellBetween` helper for proper fractional
  indexing
- **Publishing**: Requires `--allow-slow-types` flag due to LiveStore's complex
  types

## Contributing

1. **Always work on a branch** - never commit directly to `main`
2. Run `deno task ci` to check formatting, types, and tests
3. Keep commits focused and descriptive
4. Squash related commits before merging
5. Follow existing code patterns and TypeScript conventions

## Documentation

- [Agent Development Context](AGENTS.md) - Technical details for contributors
- [Package READMEs](packages/) - Individual package documentation
- [JSR Registry](https://jsr.io/@runt) - Published package versions

## License

BSD-3-Clause - See [LICENSE](LICENSE) file for details.

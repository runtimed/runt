# AI Agent Development Context

This document provides context for AI assistants working on the runt runtime
agent library.

**Current Status**: Production-ready runtime with Python execution, real-time
collaboration, and streaming output support. The unified output system provides
granular, type-safe events for rich display capabilities.

## Project Overview

Runt is a TypeScript/Deno library for building runtime agents that connect to
[Anode notebooks](https://github.com/rgbkrk/anode). It uses LiveStore for
event-sourcing and real-time sync between multiple users.

**Current Status**: Working system with 58 passing tests. Core functionality is
implemented and published to JSR. The system includes Python execution via
Pyodide, real-time collaboration, executable installation support, and agentic
AI behavior with iterative tool calls.

## Architecture

- **Schema Package** (`@runt/schema`): LiveStore schema definitions with
  TypeScript types
- **Library Package** (`@runt/lib`): Runtime agent implementation with lifecycle
  management
- **Pyodide Package** (`@runt/pyodide-runtime-agent`): Python runtime using
  Pyodide with IPython integration for rich display support
- **LiveStore**: Event-sourcing framework for local-first apps with real-time
  sync
- **Deno**: TypeScript runtime with built-in testing and formatting

## What Actually Works

- ✅ LiveStore integration with event-sourced state management
- ✅ Runtime agent lifecycle (start, execute, shutdown)
- ✅ Python code execution via Pyodide with rich formatting (matplotlib, pandas,
  HTML)
- ✅ Real-time collaboration via LiveStore sync
- ✅ CLI configuration with environment variable fallbacks
- ✅ Cross-package TypeScript imports with proper typing
- ✅ CI/CD pipeline with multi-platform testing
- ✅ JSR publishing for all packages with executable installation
- ✅ Global executable installation as `pyrunt`
- ✅ Agentic AI behavior with iterative tool call responses
- ✅ Interrupt-aware AI conversations with configurable max iterations
- ✅ Streaming output support with granular event types
- ✅ MediaBundle system for multi-format rich outputs with AI conversion

## Core Features

- **Streaming Output System**: Granular events for different output types
  (multimedia, terminal, markdown, error)
- **Python Execution**: Direct Pyodide integration with IPython rich display
  support
- **AI Integration**: Agentic behavior with tool calling and iterative responses
- **Real-time Collaboration**: LiveStore-based event sourcing for multi-user
  support
- **Rich Media Support**: Handle plots, tables, HTML, and custom display formats

## What Needs Work (Non-blocking)

- Pyodide package loading can be slow on first run
- Available Python packages are constrained by Pyodide ecosystem
- Publishing requires `--allow-slow-types` flag due to LiveStore's complex types

## Development Workflow

The user typically runs:

```bash
deno task ci        # lint, format, type-check, test
deno task test      # just run tests
deno task dev       # run example echo agent
```

When making changes:

- **Create a branch first** - never commit directly to `main`
- Edit code
- Run `deno task ci` to check everything
- Commit changes with focused, descriptive messages
- Push branch and create PR
- GitHub Actions runs the same checks

## Key Constraints

- **LiveStore Materializers**: Must be pure functions. Avoid non-deterministic
  operations (like `Date()` calls) that could produce different results across
  clients. Using `ctx.query()` for deterministic data access is fine.
- **Session Management**: Each runtime restart gets a unique `sessionId`. Handle
  session overlap during restarts.
- **Pyodide Code Execution**: Use direct `pyodide.runPythonAsync()` instead of
  IPython's `shell.run_cell()` to avoid code transformations. Process results
  through IPython's displayhook for rich formatting.
- **Duplicate Outputs**: When displayhook handles a result, don't return data
  from the execution handler to avoid duplicate execute_result outputs.
- **Agentic Conversations**: AI can iterate after tool calls, allowing it to
  respond to tool results and fix its own mistakes. Use
  `generateAgenticResponse()` for this behavior. Default max iterations is 10.
- **Interrupt Support**: AI conversations respect abort signals and can be
  interrupted during multi-iteration flows.

## File Structure

```
runt/
├── packages/
│   ├── schema/          # LiveStore schema definitions
│   │   └── mod.ts       # Events, tables, materializers
│   ├── lib/             # Runtime agent library
│   │   ├── src/         # Source code
│   │   ├── examples/    # Working examples
│   │   └── test/        # Integration tests
│   └── pyodide-runtime-agent/  # Python runtime implementation
│       └── src/         # Pyodide agent, worker, IPython setup
├── .github/workflows/   # CI/CD
└── deno.json           # Tasks and dependencies
```

## Common Issues

**LiveStore "materializer hash mismatch"**: Caused by non-deterministic
materializers. All data needed by materializers must be in the event payload,
not queried during materialization.

**Import errors**: Make sure all imports use the workspace aliases
(`@runt/schema`, `@runt/lib`) or relative paths correctly.

**Test permissions**: Tests need
`--allow-env --allow-net --allow-read --allow-write --allow-sys` flags.

**Publishing**: Requires `--allow-slow-types` flag due to LiveStore's complex
types.

**Duplicate execute results**: When using IPython's displayhook for formatting,
don't return data from the execution handler.

## Testing

- **Unit tests**: Core functionality in `src/`
- **Integration tests**: Cross-package interactions in `test/`
- **Example tests**: Ensure examples work in `examples/`

Run tests with:
`deno test --allow-env --allow-net --allow-read --allow-write --allow-sys`

## Dependencies

- `@livestore/livestore`: Event-sourcing framework
- `@livestore/adapter-node`: Node.js platform adapter
- `@livestore/sync-cf`: Cloudflare Workers sync backend
- `@std/cli`: Deno standard library for CLI parsing
- `@opentelemetry/api`: Structured logging and tracing
- `pyodide`: Python runtime in WebAssembly (for pyodide package)

All dependencies are pinned in `deno.json` import maps.

## Communication Style

- Be direct about what works and what doesn't
- Don't oversell capabilities or use marketing language
- Focus on helping developers solve actual problems
- It's okay to say "this is a prototype" or "this part needs work"
- Code examples are better than long explanations
- Keep documentation concise and consolidate when possible
- Remove marketing fluff and focus on technical accuracy
- Don't claim things "need work" without specific evidence
- Position this as a working prototype, not a production system

## Development Guidelines

- **Always work on a branch** - never commit directly to `main`
- Follow existing code patterns
- Write tests for new functionality
- Update documentation when adding features
- Use TypeScript strictly - fix all type errors
- Follow Deno formatting conventions (`deno fmt`)
- Keep commits focused and descriptive
- Squash related commits before merging to keep history clean

## For AI Assistants

When working on this codebase:

- **Create a branch first** - never work directly on `main`
- Read the existing code to understand patterns
- Run tests after making changes
- Check that CI passes before submitting
- Don't make assumptions about complex LiveStore behavior
- Ask for clarification if event-sourcing concepts are unclear
- Focus on making the code work reliably rather than adding features
- Be honest about limitations and current state
- Avoid marketing language - this is a prototype for developers

The goal is to make this library useful for developers building runtime agents,
not to impress anyone with complexity.

## Notes for AI Assistants

When working on this codebase:

- **Create a branch first** - never work directly on `main`
- Read the existing code to understand patterns
- Run tests after making changes
- Check that CI passes before submitting
- Don't make assumptions about complex LiveStore behavior
- Ask for clarification if event-sourcing concepts are unclear
- Focus on making the code work reliably rather than adding features
- Be honest about limitations and current state

The goal is to make this library useful for developers building runtime agents,
not to impress anyone with complexity.

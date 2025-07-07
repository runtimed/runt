# AI Agent Development Context

This document provides context for AI assistants working on the runt runtime
agent library.

**Current Status**: Unified Output System implementation complete - granular,
type-safe events successfully replace single `cellOutputAdded` with full
MediaBundle and ExecutionContext integration.

## Project Overview

Runt is a TypeScript/Deno library for building runtime agents that connect to
[Anode notebooks](https://github.com/rgbkrk/anode). It uses LiveStore for
event-sourcing and real-time sync between multiple users.

**Current Status**: Working system with 58 passing tests. Core functionality is
implemented and published to JSR. The system is a production-ready runtime with
Python execution via Pyodide, real-time collaboration, executable installation
support, and agentic AI behavior with iterative tool calls.

**Breaking Change Complete**: Successfully migrated from single
`cellOutputAdded` event to granular events like `multimediaDisplayOutputAdded`,
`terminalOutputAdded`, etc. providing better type safety and streaming
capabilities.

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
- ✅ Unified output system with granular, type-safe events
- ✅ MediaBundle system for multi-format rich outputs with AI conversion
- ✅ ExecutionContext methods (stdout, stderr, display, result, error, clear)
- ✅ Real-time collaboration via LiveStore sync
- ✅ CLI configuration with environment variable fallbacks
- ✅ Cross-package TypeScript imports with proper typing
- ✅ CI/CD pipeline with multi-platform testing
- ✅ Python code execution via Pyodide with rich formatting
- ✅ Direct Python code execution with IPython rich formatting
- ✅ HTML rendering, pandas tables, matplotlib SVG plots
- ✅ Real-time interrupt support via SharedArrayBuffer
- ✅ JSR publishing for all packages with executable installation
- ✅ Global executable installation as `pyrunt`
- ✅ Agentic AI behavior with iterative tool call responses
- ✅ Interrupt-aware AI conversations with configurable max iterations
- ✅ Terminal output grouping (consecutive outputs merge naturally)
- ✅ Error output rendering with proper JSON parsing
- ✅ clear_output(wait=True/False) functionality working

## Recent Major Completion ✅

- ✅ **Unified Output System**: Successfully replaced single `cellOutputAdded`
  with granular events
  - ✅ `multimediaDisplayOutputAdded` / `multimediaResultOutputAdded` for rich
    outputs
  - ✅ `terminalOutputAdded` / `terminalOutputAppended` for streaming shell
    output
  - ✅ `markdownOutputAdded` / `markdownOutputAppended` for AI responses
  - ✅ `errorOutputAdded` for execution errors
  - ✅ Enhanced `cellOutputsCleared` with `clear_output(wait=True)` support
- ✅ **ExecutionContext Integration**: All existing methods mapped to new events
- ✅ **MediaBundle Preservation**: Existing media handling seamlessly uses
  `representations` field
- ✅ **Type Safety**: Event names determine exact structure, no optional fields
  achieved
- ✅ **clear_output Implementation**: Full IPython.display.clear_output()
  functionality

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
- **Current branch**: `feature/unified-output-system` for output system refactor
- Edit code
- Run `deno task ci` to check everything
- Commit changes with focused, descriptive messages
- Push branch and create PR
- GitHub Actions runs the same checks

## Key Constraints

- **LiveStore Materializers**: Must be pure functions. Never use `ctx.query()`
  in materializers - it causes hash mismatches and runtime failures.
- **Event Schema**: Breaking changes are acceptable during current refactor
  phase. New granular events will replace existing `cellOutputAdded`.
- **Session Management**: Each runtime restart gets a unique `sessionId`. Handle
  session overlap during restarts.
- **Output Methods**: ExecutionContext methods (`stdout`, `stderr`, `display`,
  `result`, `error`, `clear`) will emit new granular events instead of single
  `cellOutputAdded`.
- **MediaBundle Integration**: Existing `MediaBundle` system becomes the
  `representations` field in multimedia events - no conversion needed.
- **Pyodide Code Execution**: Use direct `pyodide.runPythonAsync()` instead of
  IPython's `shell.run_cell()` to avoid code transformations. Process results
  through IPython's displayhook for rich formatting.
- **Duplicate Outputs**: When displayhook handles a result, don't return data
  from the execution handler to avoid duplicate execute_result outputs.
- **Clear Output Support**: New `clear_output(wait=True)` requires pending clear
  logic in materializers using `ctx.query(tables.pendingClears)`.
- **Agentic Conversations**: The AI can now iterate after tool calls, allowing
  it to respond to tool results and fix its own mistakes. Use
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

## Recent Major Completions (January 2025) ✅

- ✅ **Unified Output System Implementation**: Complete refactor from single
  `cellOutputAdded` to granular, type-safe events providing better performance
  and maintainability
- ✅ **clear_output() Functionality**: Full implementation of IPython's
  clear_output(wait=True/False) with proper pending clear logic and JavaScript
  callback integration
- ✅ **Error Output Rendering**: Fixed JSON error parsing and traceback display
  for new schema
- ✅ **Terminal Output Grouping**: Consecutive terminal outputs merge naturally
  for better UX
- ✅ **Schema Migration Complete**: All breaking changes implemented with full
  type safety
- ✅ **All Tests Updated**: 58/58 tests passing with new output structure
- ✅ **MediaBundle Integration**: Existing media handling seamlessly preserved
  as `representations`
- ✅ **Production Ready**: All components working together in real deployment
  scenarios
- ✅ **Agentic AI Behavior**: `generateAgenticResponse()` with iterative tool
  call responses
- ✅ **Interrupt-Aware Conversations**: AI conversations respect abort signals
  during iterations
- ✅ **Enhanced Tool Call Handling**: Results feed back into AI conversation for
  intelligence
- ✅ **JSR Publishing**: All packages published with proper dependency
  management
- ✅ **Global Installation**: `pyrunt` executable available via JSR installation

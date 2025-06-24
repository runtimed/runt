# Runt

Runtime agents for connecting to next gen notebooks from
[Anode](https://github.com/rgbkrk/anode).

## Packages

- `@runt/schema` - LiveStore schema (events, tables, types)
- `@runt/lib` - Runtime agent base class
- `@runt/pyodide-runtime-agent` - Python runtime using Pyodide

## Usage

```bash
deno task ci        # lint, format, type-check, test
deno task test      # run tests
deno task dev       # run example echo agent
```

Structure:

```
packages/
├── schema/                   # LiveStore schema
├── lib/                      # Runtime agent base
└── pyodide-runtime-agent/    # Python runtime
```

## Streaming Output

For AI streaming, there are two approaches depending on output type:

### Stream Output (stdout/stderr)

For token-by-token text streaming, use unfiltered methods:

```typescript
// Regular methods filter out empty/whitespace strings
context.stdout("token"); // ✅ Gets through
context.stdout(""); // ❌ Filtered out

// Raw methods preserve ALL tokens for streaming
context.stdoutRaw("token"); // ✅ Gets through
context.stdoutRaw(""); // ✅ Gets through
```

### Display Data Streaming

For AI responses using `text/markdown` display data, use replacement updates:

```typescript
// Create initial display
context.display({
  "text/markdown": "# AI Response\n\n_Thinking..._",
});

// Stream updates by replacing content
const outputId = "response-123";
context.displayReplace(outputId, {
  "text/markdown": "# AI Response\n\nHere's my answer...",
});
```

Perfect for building up AI responses incrementally with smooth streaming UX.

## Notes

- LiveStore materializers must be pure functions
- Events can't be removed once added
- Each runtime restart gets unique `sessionId`
- Publishing requires `--allow-slow-types` flag (Deno limitation)

Examples in `packages/lib/examples/`.

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

For AI responses using `text/markdown` display data, choose your approach:

**Option 1: Replace (Full Content)**

```typescript
// Create initial display
const outputId = crypto.randomUUID();
context.display({
  "text/markdown": "# AI Response\n\n_Thinking..._",
});

// Replace with growing content
context.displayReplace(outputId, {
  "text/markdown": "# AI Response\n\nHere's my complete answer...",
});
```

**Option 2: Append (Efficient Token Streaming)**

```typescript
// Create initial display
const outputId = crypto.randomUUID();
context.display({
  "text/markdown": "# AI Response\n\n",
});

// Append each token efficiently
context.displayAppend(outputId, "text/markdown", "Hello");
context.displayAppend(outputId, "text/markdown", " ");
context.displayAppend(outputId, "text/markdown", "world!");
```

Perfect for AI responses with both full-replacement and efficient token-by-token
streaming patterns.

## Notes

- LiveStore materializers must be pure functions
- Events can't be removed once added
- Each runtime restart gets unique `sessionId`
- Publishing requires `--allow-slow-types` flag (Deno limitation)

Examples in `packages/lib/examples/`.

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

For AI token streaming and real-time output, use the unfiltered methods:

```typescript
// Regular methods filter out empty/whitespace strings
context.stdout("token"); // ✅ Gets through
context.stdout(""); // ❌ Filtered out
context.stdout("   "); // ❌ Filtered out

// Raw methods preserve ALL tokens for streaming
context.stdoutRaw("token"); // ✅ Gets through
context.stdoutRaw(""); // ✅ Gets through
context.stdoutRaw("   "); // ✅ Gets through
```

Perfect for AI responses where every token matters for smooth streaming UX.

## Notes

- LiveStore materializers must be pure functions
- Events can't be removed once added
- Each runtime restart gets unique `sessionId`
- Publishing requires `--allow-slow-types` flag (Deno limitation)

Examples in `packages/lib/examples/`.

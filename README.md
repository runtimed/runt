# Runt

Runtime agents for connecting to next gen notebooks from
[Anode](https://github.com/rgbkrk/anode).

## Packages

- `@runt/schema` - LiveStore schema (events, tables, types)
- `@runt/lib` - Runtime agent base class
- `@runt/pyodide-runtime-agent` - Python runtime using Pyodide
- `@runt/tui` - Terminal notebook viewer

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
├── pyodide-runtime-agent/    # Python runtime
└── tui/                      # Terminal viewer
```

## Notes

- LiveStore materializers must be pure functions
- Each runtime restart gets unique `sessionId`
- Publishing requires `--allow-slow-types` flag

Examples in `packages/lib/examples/`.

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

## Notes

- LiveStore materializers must be pure functions
- Events can't be removed once added
- Each runtime restart gets unique `sessionId`
- Publishing requires `--allow-slow-types` flag (Deno limitation)

Examples in `packages/lib/examples/`.

## Development

### Schema Linking

The `@runt/schema` package can be linked in different ways depending on your
development phase:

**Production (JSR Package)**:

```json
"@runt/schema": "jsr:^0.6.0"
```

**Testing PR Changes (GitHub Reference)**:

```json
"@runt/schema": "github:runtimed/runt#1d52f9e51b9f28e81e366a7053d1e5fa6164c390&path:/packages/schema"
```

**Local Development (File Link)**:

```json
"@runt/schema": "file:../runt/packages/schema"
```

**To switch between modes:**

1. Update `package.json` with the appropriate schema reference
2. Run `pnpm install` (for Node.js projects) or restart Deno
3. Restart development servers

**Important**: Ensure all consuming projects use compatible schema versions.

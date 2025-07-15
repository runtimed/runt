# @runt/tui

Terminal notebook viewer for Runt runtime agents with real-time collaboration
support.

## Features

- Terminal notebook viewer with syntax highlighting
- Real-time sync via LiveStore
- Rich output display (code, markdown, multimedia, errors)
- Clickable URLs and navigation controls
- Debug logging integration

## Usage

```bash
# View a notebook
deno run --allow-all jsr:@runt/tui --notebook=notebook-123
```

### Environment Variables

- `LIVESTORE_SYNC_URL`: LiveStore sync backend URL
- `AUTH_TOKEN`: Authentication token

### Controls

- `↑/↓`: Navigate cells
- `L`: Toggle debug logs
- `Ctrl+C`: Exit

## Development

```bash
deno task dev     # Run locally
deno task check   # Type check
deno task fmt     # Format
```

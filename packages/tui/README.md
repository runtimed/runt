# @runt/tui

Terminal notebook viewer for Runt runtime agents with real-time collaboration
support.

## Features

- Interactive terminal notebook interface
- Edit and execute code cells directly in the terminal
- Real-time collaboration and sync via LiveStore
- Rich output display (code, markdown, multimedia, errors)
- Syntax highlighting for code cells
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

**Command Mode:**

- `↑/↓` or `k/j`: Navigate cells
- `Enter` or `i`: Enter edit mode for the selected cell
- `r`: Execute the selected cell and create a new cell below
- `R`: Execute the selected cell only
- `a`: Insert a new cell above the selected cell
- `b`: Insert a new cell below the selected cell
- `dd` (press `d` twice): Delete the selected cell
- `l`: Toggle debug logs
- `Ctrl+C`: Exit

**Edit Mode:**

- `Ctrl+R`: Execute the cell and create a new cell below
- `Ctrl+E`: Execute the cell only
- `Esc`: Save changes and return to command mode
- `Ctrl+C`: Cancel editing and return to command mode

## Development

```bash
deno task dev     # Run locally
deno task check   # Type check
deno task fmt     # Format
```

# Development Guide

## Quick Reference

| Task | Command |
|------|---------|
| Start dev server | `cargo xtask dev` |
| Quick debug build | `cargo xtask build` |
| Build and run | `cargo xtask run` |
| Run with notebook | `cargo xtask build && ./target/debug/notebook path/to/notebook.ipynb` |
| Build release .app | `cargo xtask build-app` |
| Build release DMG | `cargo xtask build-dmg` |

## Choosing a Workflow

### `cargo xtask dev` — Hot Reload

Best for UI/React development. Uses Vite dev server on port 5174. Changes to React components hot-reload instantly.

```bash
cargo xtask dev
```

### `cargo xtask build` / `run` — Debug Build

Best for:
- Testing Rust changes
- Multiple worktrees (avoids port 5174 conflicts)
- Quick manual testing

Builds a debug binary without DMG creation.

```bash
# Build only
cargo xtask build

# Build and run
cargo xtask run

# Build and open a specific notebook
cargo xtask build
./target/debug/notebook path/to/notebook.ipynb
```

**Note:** Use `./target/debug/notebook` directly to open notebooks with file paths. The `cargo xtask run` command doesn't pass file arguments through correctly.

### `cargo xtask build-app` / `build-dmg` — Release Builds

Mostly handled by CI for preview releases. Use locally only when testing:
- App bundle structure
- File associations
- Icons

## Build Order

The UI must be built before Rust because:
- `crates/sidecar` embeds assets from `apps/sidecar/dist/` at compile time via rust-embed
- `crates/notebook` embeds assets from `apps/notebook/dist/` via Tauri

The xtask commands handle this automatically. If building manually:

```bash
pnpm build          # Build all UIs (sidecar, notebook — isolated-renderer built inline)
cargo build         # Build Rust
```

## Test Notebooks

The `notebooks/` directory has test files:

```bash
cargo xtask build
./target/debug/notebook notebooks/test-isolation.ipynb
```

## Daemon Development

The notebook app connects to a background daemon (`runtimed`) that manages prewarmed environments and notebook document sync. **Important:** The daemon is a separate process. When you change code in `crates/runtimed/`, the running daemon still uses the old binary until you reinstall it.

### Development Mode (Per-Worktree Isolation)

In production, the Tauri app auto-installs and manages the system daemon. In development, you control the daemon yourself, which gives you:

- Isolated state per worktree (no conflicts when testing across branches)
- Your code changes take effect immediately on daemon restart
- No interference with the system daemon

**Two-terminal workflow:**

```bash
# Terminal 1: Start the dev daemon (stays running)
cargo xtask dev-daemon

# Terminal 2: Run the notebook app
cargo xtask dev              # Hot-reload mode
# or
cargo xtask build && ./target/debug/notebook   # Debug build
```

The app detects dev mode and connects to the per-worktree daemon instead of installing/starting the system daemon.

**Conductor users:** Dev mode is automatic when `CONDUCTOR_WORKSPACE_PATH` is set.

**Non-Conductor users:** Set `RUNTIMED_DEV=1`:

```bash
# Terminal 1
RUNTIMED_DEV=1 cargo xtask dev-daemon

# Terminal 2
RUNTIMED_DEV=1 cargo xtask dev
```

**Useful commands:**

```bash
runt daemon status           # Shows dev mode, worktree path, version
runt daemon list-worktrees   # List all running dev daemons
runt daemon logs -f          # Tail logs (uses correct log path in dev mode)
```

Per-worktree state is stored in `~/.cache/runt/worktrees/{hash}/`.

### Testing Against System Daemon (Production Mode)

When you need to test the full production flow (daemon auto-install, upgrades, etc.):

```bash
# Make sure dev mode is NOT set
unset RUNTIMED_DEV
unset CONDUCTOR_WORKSPACE_PATH

# Rebuild and reinstall system daemon
cargo xtask install-daemon

# Run the app (it will connect to system daemon)
cargo xtask dev
```

### Daemon logs

```bash
# View recent logs
runt daemon logs -n 100

# Watch logs in real-time
runt daemon logs -f

# Filter for specific topics
runt daemon logs -f | grep -i "kernel\|auto-detect"
```

### Common gotchas

If your daemon code changes aren't taking effect:
1. **In dev mode:** Did you restart `cargo xtask dev-daemon`?
2. **In production mode:** Did you run `cargo xtask install-daemon`?
3. Check which daemon is running: `runt daemon status`

If the app says "Dev daemon not running":
- You're in dev mode but haven't started the dev daemon
- Run `cargo xtask dev-daemon` in another terminal first

See [contributing/runtimed.md](./runtimed.md) for full daemon development docs.

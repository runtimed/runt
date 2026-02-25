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

### Reinstalling the daemon

```bash
# Rebuild and reinstall (builds release, stops old, copies, restarts)
cargo xtask install-daemon

# Verify version
cat ~/Library/Caches/runt/daemon.json
```

### Daemon logs

```bash
# View recent logs
runt daemon logs -n 100

# Watch logs in real-time
runt daemon logs -f

# Filter for specific topics (can combine with grep)
runt daemon logs -f | grep -i "kernel\|auto-detect"
```

### Common gotcha

If your daemon code changes aren't taking effect:
1. Did you run `cargo xtask install-daemon`? (`cargo xtask build` doesn't reinstall the daemon)
2. Is the daemon running the right version? Check `runt daemon status`

See [contributing/runtimed.md](./runtimed.md) for full daemon development docs.

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

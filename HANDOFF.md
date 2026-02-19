# Runtimed Development Handoff

This document provides context for continuing development on the `runtimed` daemon.

## Current State

**Branch:** `rgbkrk/pool-daemon-prototype`
**PR:** #150 - "Fix crash when creating multiple notebooks rapidly (Cmd-N)"

The daemon is fully functional and integrated with the notebook crate. All tests pass.

## What is runtimed?

`runtimed` is a centralized daemon that manages prewarmed Python environments for Jupyter notebooks. It provides:

- **UV environments** - Fast Python venvs using uv
- **Conda environments** - Full conda environments using rattler (no external mamba/conda needed)
- **Instant notebook startup** - Notebooks get prewarmed environments immediately instead of waiting for creation
- **Singleton pattern** - Only one daemon runs at a time via file locking

## Architecture

```
┌─────────────────┐     Unix Socket (NDJSON)     ┌─────────────────┐
│    Notebook     │ ───────────────────────────► │    runtimed     │
│   (client)      │     GetEnv { env_type }      │    (daemon)     │
│                 │ ◄─────────────────────────── │                 │
│                 │     PooledEnv { ... }        │   UV Pool (3)   │
│                 │                              │  Conda Pool (3) │
└─────────────────┘                              └─────────────────┘
```

## Key Files

### Daemon (crates/runtimed/)
- `src/daemon.rs` - Core daemon: pool management, warming loops, socket server
- `src/client.rs` - Client API: `try_get_pooled_env()` for notebooks
- `src/singleton.rs` - File-based singleton locking
- `src/pool.rs` - Pool state machine (Available/Warming counts)
- `src/lib.rs` - Public exports: `EnvType`, `PooledEnv`, `PoolStatus`

### Notebook Integration (crates/notebook/)
- `src/env_pool.rs` - `take_uv_env()` and `take_conda_env()` helpers
  - Try daemon first (fast, non-blocking)
  - Fall back to in-process pool if daemon unavailable
- `src/lib.rs` - Three locations call the take functions (~lines 1115, 1325, 1469)

### Documentation
- `contributing/runtimed.md` - Developer guide
- `docs/runtimed.md` - User-facing documentation

## How It Works

### Daemon Startup
1. Acquires singleton lock (`~/.cache/runt/daemon.lock`)
2. Scans cache dir for existing `runtimed-uv-*` and `runtimed-conda-*` directories
3. Validates existing envs (checks python binary exists)
4. Adds valid envs to pool immediately (instant 3/3 availability)
5. Starts warming loops to replenish any missing envs

### Environment Creation
- **UV**: Uses `uv venv` + `uv pip install ipykernel ipywidgets`
- **Conda**: Uses rattler (Rust-native conda) to create envs with python, ipykernel, ipywidgets

### Notebook Takes Environment
1. Notebook calls `take_uv_env()` or `take_conda_env()`
2. Helper tries daemon first via Unix socket
3. If daemon returns env, use it immediately
4. If daemon unavailable/empty, fall back to in-process pool
5. Daemon logs "Took conda env:" and starts replenishing

## Environment Prefixes

Important: The daemon uses different prefixes than the notebook's in-process pool:
- Daemon: `runtimed-uv-*`, `runtimed-conda-*`
- Notebook: `prewarm-*`

This prevents collision - the notebook's cleanup won't delete daemon environments.

## Running the Daemon

```bash
# Development (with logging)
RUST_LOG=info cargo run -p runtimed

# Check status
cargo run -p runtimed -- status

# Stop daemon
cargo run -p runtimed -- stop
```

## Running Tests

```bash
# Stop daemon first (one test expects no daemon)
cargo run -p runtimed -- stop

# Run tests
cargo test -p runtimed
```

## Recent Changes (This Session)

1. **Rattler-based conda warming** - Uses rattler instead of CLI mamba/conda
2. **Daemon-first environment fetching** - Notebook tries daemon before in-process pool
3. **Environment reuse on startup** - Daemon finds and reuses existing runtimed-* directories
4. **Prefix namespacing** - Changed from `prewarm-*` to `runtimed-*` to avoid collision

## Known Working State

Tested with daemon running and opening 3 notebooks:
- All notebooks got conda environments from daemon
- Daemon replenished pool back to 3/3
- Warmup completed successfully for all replacement envs
- UV pool stayed at 3/3 (notebooks used conda in this test)

## Potential Future Work

- Automatic daemon startup (launchd/systemd service files)
- Configurable package lists
- Environment cleanup/garbage collection for old unused envs
- Metrics/telemetry for environment usage patterns
- Support for custom conda channels

## Log Location

```
/Users/kylekelley/Library/Caches/runt/runtimed.log
```

Watch live: `tail -f /Users/kylekelley/Library/Caches/runt/runtimed.log`

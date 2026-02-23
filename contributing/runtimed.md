# Runtime Daemon (runtimed)

The runtime daemon manages prewarmed Python environments shared across notebook windows.

## Quick Reference

| Task | Command |
|------|---------|
| Install daemon from source | `cargo xtask install-daemon` |
| Run daemon | `cargo run -p runtimed` |
| Run with debug logs | `RUST_LOG=debug cargo run -p runtimed` |
| Check status | `cargo run -p runt-cli -- pool status` |
| Ping daemon | `cargo run -p runt-cli -- pool ping` |
| Run tests | `cargo test -p runtimed` |

## Why It Exists

Each notebook window is a separate OS process (Tauri spawns via `spawn_new_notebook()` in `crates/notebook/src/lib.rs`). Without coordination:

1. **Race conditions**: Multiple windows try to claim the same prewarmed environment
2. **Wasted resources**: Each window creates its own pool of environments
3. **Slow cold starts**: First notebook waits for environment creation

The daemon provides a single coordinating entity that prewarms environments in the background and hands them out to windows on request.

## Architecture

```
┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
│  Notebook Win 1  │   │  Notebook Win 2  │   │  Notebook Win N  │
│  (Tauri process) │   │  (Tauri process) │   │  (Tauri process) │
└────────┬─────────┘   └────────┬─────────┘   └────────┬─────────┘
         │                      │                      │
         │     Unix Socket      │     Unix Socket      │
         └──────────┬───────────┴───────────┬──────────┘
                    │                       │
                    ▼                       ▼
              ┌─────────────────────────────────┐
              │            runtimed             │
              │      (singleton daemon)         │
              │                                 │
              │  ┌──────────┐  ┌──────────────┐ │
              │  │ UV Pool  │  │  Conda Pool  │ │
              │  │ (3 envs) │  │   (3 envs)   │ │
              │  └──────────┘  └──────────────┘ │
              └─────────────────────────────────┘
```

**Key components:**

| Component | Purpose | Location |
|-----------|---------|----------|
| Unix socket | IPC endpoint | `~/.cache/runt/runtimed.sock` |
| Lock file | Singleton guarantee | `~/.cache/runt/daemon.lock` |
| Info file | Discovery (PID, endpoint) | `~/.cache/runt/daemon.json` |
| Environments | Prewarmed venvs | `~/.cache/runt/envs/` |

## Development Workflow

### Default: Let the notebook start it

The notebook app automatically tries to connect to or start the daemon on launch. If it's not running, the app falls back to in-process prewarming. You don't need to do anything special.

```rust
// crates/notebook/src/lib.rs:2408
runtimed::client::ensure_daemon_running(None).await
```

### Install daemon from source

When you change daemon code and want the installed service to pick it up:

```bash
cargo xtask install-daemon
```

This builds runtimed in release mode, stops the running service, replaces the binary, and restarts it. You can verify the version with:

```bash
cat ~/.cache/runt/daemon.json   # check "version" field
```

### Manual: Run daemon separately

For debugging daemon-specific code, stop the installed service and run from source:

```bash
# Stop the installed service first
launchctl bootout gui/$(id -u)/io.runtimed

# Run daemon with debug logs
RUST_LOG=debug cargo run -p runtimed

# In another terminal, test with runt CLI
cargo run -p runt-cli -- pool ping
cargo run -p runt-cli -- pool status
cargo run -p runt-cli -- pool take uv
```

### Testing

```bash
# All tests (unit + integration)
cargo test -p runtimed

# Just integration tests
cargo test -p runtimed --test integration

# Specific test
cargo test -p runtimed test_daemon_ping_pong
```

Integration tests use temp directories for socket and lock files to avoid conflicts with a running daemon.

## Code Structure

```
crates/runtimed/
├── src/
│   ├── lib.rs                   # Public types, path helpers (default_socket_path, etc.)
│   ├── main.rs                  # CLI entry point (run, install, status, etc.)
│   ├── daemon.rs                # Daemon state, pool management, connection routing
│   ├── connection.rs            # Unified framing, Handshake enum, send/recv helpers
│   ├── protocol.rs              # Request/Response enums, BlobRequest/BlobResponse
│   ├── client.rs                # PoolClient for pool operations
│   ├── singleton.rs             # File-based locking for single instance
│   ├── service.rs               # Cross-platform service installation
│   ├── settings_doc.rs          # Settings Automerge document, schema, migration
│   ├── sync_server.rs           # Settings sync handler
│   ├── sync_client.rs           # Settings sync client library
│   ├── notebook_doc.rs          # Notebook Automerge document, cell CRUD, text editing
│   ├── notebook_sync_server.rs  # Room-based notebook sync, peer management, eviction
│   ├── notebook_sync_client.rs  # Notebook sync client library
│   ├── blob_store.rs            # Content-addressed blob store with metadata sidecars
│   ├── blob_server.rs           # HTTP read server for blobs (hyper 1.x)
│   └── runtime.rs               # Runtime detection (Python/Deno)
└── tests/
    └── integration.rs           # Integration tests (daemon, pool, settings sync, notebook sync)
```

For the full architecture (all phases, schemas, and design decisions), see [docs/runtimed.md](../docs/runtimed.md).

## Protocol

All daemon communication goes through a single Unix socket with channel-based routing. Connections start with a JSON handshake:

```rust
pub enum Handshake {
    Pool,
    SettingsSync,
    NotebookSync { notebook_id: String },
    Blob,
}
```

**Pool channel** uses length-framed JSON request/response (short-lived). Request types: `ping`, `status`, `take`, `return`, `shutdown`.

**SettingsSync / NotebookSync** channels use Automerge sync messages (long-lived, bidirectional).

**Blob channel** uses binary framing for storing content-addressed blobs.

## CLI Commands (for testing)

The `runt` CLI has pool subcommands for testing:

```bash
cargo run -p runt-cli -- pool ping          # Check daemon is responding
cargo run -p runt-cli -- pool status        # Show pool statistics
cargo run -p runt-cli -- pool status --json # JSON output
cargo run -p runt-cli -- pool take uv       # Request a UV environment
cargo run -p runt-cli -- pool shutdown      # Stop the daemon
```

## Troubleshooting

### Daemon won't start (lock held)

```bash
# Check what's holding the lock
cat ~/.cache/runt/daemon.json
lsof ~/.cache/runt/daemon.lock

# If stale (crashed daemon), remove manually
rm ~/.cache/runt/daemon.lock ~/.cache/runt/daemon.json
```

### Pool not replenishing

Check that uv/conda are installed and working:

```bash
uv --version
ls -la ~/.cache/runt/envs/
```

## Shipped App Behavior

When shipped as a release build, the daemon installs as a system service that starts at login. This is handled by `crates/runtimed/src/service.rs`:

- **macOS**: launchd plist in `~/Library/LaunchAgents/`
- **Linux**: systemd user service in `~/.config/systemd/user/`
- **Windows**: Startup folder script

### Managing the Installed Service (for developers)

If you have the app installed and want to run a development version of the daemon instead, you'll need to stop the installed service first.

**macOS:**
```bash
# Stop the installed daemon
launchctl unload ~/Library/LaunchAgents/io.runtimed.plist

# Check status
launchctl list | grep io.runtimed

# Restart it later
launchctl load ~/Library/LaunchAgents/io.runtimed.plist

# Full uninstall (removes binary and service config)
~/Library/Application\ Support/runt/bin/runtimed uninstall
```

**Linux:**
```bash
# Stop the installed daemon
systemctl --user stop runtimed.service

# Check status
systemctl --user status runtimed.service

# Restart it later
systemctl --user start runtimed.service

# Full uninstall
~/.local/share/runt/bin/runtimed uninstall
```

**Key paths (macOS):**
| File | Path |
|------|------|
| Installed binary | `~/Library/Application Support/runt/bin/runtimed` |
| Service config | `~/Library/LaunchAgents/io.runtimed.plist` |
| Socket | `~/Library/Caches/runt/runtimed.sock` |
| Daemon info | `~/Library/Caches/runt/daemon.json` |
| Logs | `~/Library/Caches/runt/runtimed.log` |

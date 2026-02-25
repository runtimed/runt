# Runtimed Development Handoff

This document provides context for continuing development on the `runtimed` daemon.

## What is runtimed?

`runtimed` is a background daemon that manages the stateful parts of the notebook experience:

- **Environment pools** - Prewarmed UV and Conda environments for instant notebook startup
- **Notebook sync** - Real-time CRDT synchronization across multiple windows via Automerge
- **Settings sync** - User preferences shared across all notebook windows
- **Blob store** - Content-addressed storage for outputs with HTTP serving
- **Kernel management** - Daemon-owned kernel execution (behind `daemon_execution` flag)

The daemon runs as a system service (`io.runtimed` on macOS, `runtimed.service` on Linux) and communicates via Unix socket.

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
              │  ┌──────────────────────────┐   │
              │  │ CRDT Sync (Automerge)    │   │
              │  │ - Settings doc           │   │
              │  │ - Notebook rooms         │   │
              │  └──────────────────────────┘   │
              │  ┌──────────────────────────┐   │
              │  │ Blob Store + HTTP server │   │
              │  └──────────────────────────┘   │
              └─────────────────────────────────┘
```

## Key Files

### Daemon (crates/runtimed/)
| File | Role |
|------|------|
| `daemon.rs` | Core daemon: pool management, warming loops, connection routing |
| `client.rs` | Client API: `PoolClient` for pool operations |
| `singleton.rs` | File-based singleton locking, DaemonInfo discovery |
| `protocol.rs` | Request/Response enums, BlobRequest/BlobResponse |
| `connection.rs` | Unified framing, handshake enum, send/recv helpers |
| `settings_doc.rs` | Settings Automerge document, schema, migration |
| `notebook_doc.rs` | Notebook Automerge document, cell CRUD, text editing |
| `notebook_sync_server.rs` | Room-based notebook sync, peer management |
| `blob_store.rs` | Content-addressed blob store with metadata sidecars |
| `blob_server.rs` | HTTP read server for blobs |
| `service.rs` | Platform-specific service installation |

### CLI (crates/runt/)
| File | Role |
|------|------|
| `main.rs` | Unified CLI: daemon management, kernel listing, notebook inspection |

### Documentation
- `contributing/runtimed.md` - Developer guide
- `docs/runtimed.md` - Full architecture documentation

## Running the Daemon

```bash
# Development (with logging)
RUST_LOG=info cargo run -p runtimed

# Check status via CLI
runt daemon status

# Stop daemon
runt daemon stop

# View logs
runt daemon logs -f
```

## Running Tests

```bash
# Stop daemon first (some tests expect no daemon)
runt daemon stop

# Run tests
cargo test -p runtimed
```

## CLI Commands

The `runt` CLI is the unified interface for all daemon and kernel operations:

```bash
# Daemon management
runt daemon status        # Service + pool + version info
runt daemon start         # Start the daemon service
runt daemon stop          # Stop the daemon service
runt daemon restart       # Restart the daemon
runt daemon logs -f       # Tail daemon logs
runt daemon flush         # Flush pool and rebuild environments
runt daemon install       # Install as system service
runt daemon uninstall     # Uninstall system service

# Kernel and notebook inspection
runt ps                   # List all kernels (connection-file + daemon-managed)
runt notebooks            # List open notebooks with kernel/peer info

# Jupyter kernel utilities
runt jupyter start <name> # Start a connection-file kernel
runt jupyter stop --all   # Stop connection-file kernels
runt jupyter console      # Interactive REPL
```

## Log Location

```
~/Library/Caches/runt/runtimed.log  (macOS)
~/.cache/runt/runtimed.log          (Linux)
```

Watch live: `runt daemon logs -f`

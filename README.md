# Runt

A fast, modern toolkit for Jupyter notebooks. Native desktop app with instant startup, real-time collaboration, and intelligent environment management.

Built on [runtimelib](https://crates.io/crates/runtimelib) and [jupyter-protocol](https://crates.io/crates/jupyter-protocol).

## Install

```bash
curl https://i.safia.sh/runtimed/runt | sh
```

Or via pip:

```bash
pip install runtimed
```

## What's in here

|  App  | Description |
|-----------|-------------|
| `runt` | CLI for managing kernels, notebooks, and the daemon |
| `runtimed` | Background daemon managing environment pools, notebook sync, and kernel execution |
| `notebook` | Desktop notebook editor (Tauri + React) |
| `sidecar` | Desktop viewer for Jupyter kernel outputs |
| `runtimed` (PyPI) | Python package bundling the `runt` binary |

## Usage

```bash
# List all kernels (connection-file and daemon-managed)
runt ps

# Launch notebook editor
runt notebook [path/to/notebook.ipynb]

# Interactive console
runt console

# Daemon management
runt daemon status     # Check daemon and pool status
runt daemon start      # Start the daemon service
runt daemon stop       # Stop the daemon service
runt daemon logs -f    # Tail daemon logs

# List open notebooks with kernel info
runt notebooks

# Jupyter kernel utilities
runt jupyter start python3    # Start a connection-file kernel
runt jupyter stop --all       # Stop all connection-file kernels
runt jupyter sidecar <file>   # Launch sidecar output viewer
```

## Project structure

```
runt/
├── src/                    # Shared UI code (React components, hooks, utilities)
│   ├── components/
│   │   ├── ui/            # shadcn primitives (button, dialog, etc.)
│   │   ├── cell/          # Notebook cell components
│   │   ├── outputs/       # Output renderers (stream, error, display data)
│   │   ├── editor/        # CodeMirror editor
│   │   └── widgets/       # ipywidgets controls
│   └── lib/
│       └── utils.ts       # cn() and other utilities
├── apps/                   # App entry points
│   ├── notebook/          # Notebook Tauri frontend
│   └── sidecar/           # Sidecar WebView frontend
├── crates/                 # Rust code
│   ├── runt/              # CLI binary
│   ├── runtimed/          # Background daemon
│   ├── notebook/          # Notebook Tauri app
│   ├── sidecar/           # Sidecar wry/tao app
│   └── tauri-jupyter/     # Shared Tauri/Jupyter utilities
├── docs/                   # Architecture documentation
└── contributing/           # Developer guides
```

## Development

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | https://nodejs.org |
| pnpm | 10.12+ | `corepack enable` |
| Rust | 1.90.0 | https://rustup.rs (version managed by `rust-toolchain.toml`) |

**Linux only:** Install GTK/WebKit dev libraries:
```bash
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libxdo-dev
```

### Quick start

```bash
# Install dependencies
pnpm install

# Build everything
pnpm build
cargo build --release
```

### Development workflows

| Workflow | Command | Use when |
|----------|---------|----------|
| Hot reload | `cargo xtask dev` | Iterating on React UI |
| Standalone Vite | `cargo xtask vite` | Multi-window testing (Vite survives window closes) |
| Attach to Vite | `cargo xtask dev --attach` | Connect Tauri to already-running Vite |
| Debug build | `cargo xtask build` | Full debug build (frontend + rust) |
| Rust-only build | `cargo xtask build --rust-only` | Rebuild rust, reuse existing frontend |
| Run bundled | `cargo xtask run notebook.ipynb` | Run standalone binary |
| Release .app | `cargo xtask build-app` | Testing app bundle locally |
| Release DMG | `cargo xtask build-dmg` | Distribution (usually CI) |

**Hot reload** connects to Vite dev server (port 5174) for instant UI updates.

**Multi-window testing**: Use `cargo xtask vite` + `cargo xtask dev --attach` to keep Vite running when closing/reopening Tauri windows.

**Daemon iteration**: Use `cargo xtask build` once, then `cargo xtask build --rust-only` for fast rebuilds when only changing Rust code.

### Sidecar UI development

```bash
pnpm --dir apps/sidecar dev
```

Both apps share components from `src/`. Changes there are reflected in both.

### Adding shadcn components

Run from the repo root:

```bash
npx shadcn@latest add <component>
```

Components are added to `src/components/ui/`.

### Build order

The UI must be built before Rust because:
- `crates/sidecar` embeds assets from `apps/sidecar/dist/` at compile time via [rust-embed](https://crates.io/crates/rust-embed)
- `crates/notebook` embeds assets from `apps/notebook/dist/` via Tauri

### Common commands

```bash
# Build all UIs
pnpm build

# Build specific app
pnpm --dir apps/notebook build
pnpm --dir apps/sidecar build

# Run tests
cargo test

# Lint
cargo clippy --all-targets -- -D warnings

# Format
cargo fmt
```

## Library crates

The underlying Rust libraries live in [runtimed/runtimed](https://github.com/runtimed/runtimed) and are published to crates.io:

- [`jupyter-protocol`](https://crates.io/crates/jupyter-protocol) — Core Jupyter messaging
- [`runtimelib`](https://crates.io/crates/runtimelib) — Jupyter kernel interactions over ZeroMQ
- [`nbformat`](https://crates.io/crates/nbformat) — Notebook parsing

## License

BSD-3-Clause

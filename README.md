# Runt

CLI and desktop tools for [Jupyter runtimes](https://github.com/runtimed/runtimed), powered by [runtimelib](https://crates.io/crates/runtimelib) and [jupyter-protocol](https://crates.io/crates/jupyter-protocol).

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
| `runt` | CLI for managing and interacting with Jupyter kernels |
| `sidecar` | Desktop viewer for Jupyter kernel outputs |
| `notebook` | Desktop notebook editor (Tauri + React) |
| `runtimed` (PyPI) | Python package bundling the `runt` binary |

## Usage

```bash
# List running kernels
runt ps

# Start a kernel
runt start python3

# Interactive console
runt console

# Launch sidecar output viewer
runt sidecar <connection-file>

# Launch notebook editor
runt notebook
```

## Project structure

```
sun-valley/
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
│   ├── runt/              # Main CLI binary
│   ├── notebook/          # Notebook Tauri app
│   ├── sidecar/           # Sidecar wry/tao app
│   └── tauri-jupyter/     # Shared Tauri/Jupyter utilities
└── components.json         # shadcn config (run commands from repo root)
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

### UI development

Both apps share components from `src/`. Changes there are reflected in both.

```bash
# Notebook UI with hot reload (runs Vite dev server + Tauri)
cd crates/notebook && cargo tauri dev

# Sidecar UI dev server (for styling/component work)
pnpm --dir apps/sidecar dev
```

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

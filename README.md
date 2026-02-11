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

| Package | Description |
|---------|-------------|
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
cargo run -p notebook
```

## Building from source

```bash
pnpm install
pnpm --dir packages/sidecar-ui build
pnpm --dir packages/notebook-ui build
cargo build --release
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
sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev
```

### Build order

The UI packages must be built before the Rust build because:
- `crates/sidecar` embeds UI assets from `packages/sidecar-ui/dist/` at compile time via [rust-embed](https://crates.io/crates/rust-embed)
- `crates/notebook` embeds UI assets from `packages/notebook-ui/dist/` at compile time via Tauri

### Common commands

```bash
# Run tests
cargo test

# Lint Rust
cargo clippy --all-targets -- -D warnings

# Format Rust
cargo fmt

# UI dev server (for sidecar UI development)
pnpm --dir packages/sidecar-ui dev

# UI dev server (for notebook UI development)
pnpm --dir packages/notebook-ui dev
```

## Library crates

The underlying Rust libraries live in [runtimed/runtimed](https://github.com/runtimed/runtimed) and are published to crates.io:

- [`jupyter-protocol`](https://crates.io/crates/jupyter-protocol) — Core Jupyter messaging
- [`runtimelib`](https://crates.io/crates/runtimelib) — Jupyter kernel interactions over ZeroMQ
- [`nbformat`](https://crates.io/crates/nbformat) — Notebook parsing

## License

BSD-3-Clause

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
```

## Building from source

```bash
# Build UIs first
pnpm install
pnpm --dir packages/ui build
pnpm --dir packages/sidecar-ui build

# Build Rust
cargo build --release
```

## Library crates

The underlying Rust libraries live in [runtimed/runtimed](https://github.com/runtimed/runtimed) and are published to crates.io:

- [`jupyter-protocol`](https://crates.io/crates/jupyter-protocol) — Core Jupyter messaging
- [`runtimelib`](https://crates.io/crates/runtimelib) — Jupyter kernel interactions over ZeroMQ
- [`nbformat`](https://crates.io/crates/nbformat) — Notebook parsing

## License

BSD-3-Clause

# Releasing

## Runt CLI & Sidecar

`sidecar` and `runt-cli` are **not published to crates.io** (`publish = false`). Sidecar embeds UI assets from `packages/sidecar-ui/dist` via `rust-embed`, which requires files outside the crate directory — incompatible with `cargo publish`.

These are distributed as:

- **Prebuilt binaries** via GitHub Releases (automated weekly preview releases)
- **Python package** (`runtimed`) on PyPI, which bundles the `runt` binary

## Python Package (runtimed)

The Python package bundles the `runt` binary and is released separately.

### 1. Bump the version

Edit `python/runtimed/pyproject.toml` and update the `version` field.

### 2. Create a PR

Open a PR with the version bump, get it reviewed and merged.

### 3. Tag and push

```
git tag python-v<version>
git push origin python-v<version>
```

The `python-package.yml` workflow triggers on `python-v*` tags and will:
- Build wheels for macOS (arm64 + x64) and Linux (x64)
- Publish to PyPI via trusted publishing
- Create a GitHub release with wheels and `runt` binaries

## Development

### Building from source

```bash
# Build UIs first
pnpm install
pnpm --dir packages/ui build
pnpm --dir packages/sidecar-ui build

# Build Rust
cargo build --release
```

### Testing with local runtimed library changes

To test against unpublished library changes, add to the root `Cargo.toml`:

```toml
[patch.crates-io]
runtimelib = { path = "../runtimed/crates/runtimelib" }
jupyter-protocol = { path = "../runtimed/crates/jupyter-protocol" }
```

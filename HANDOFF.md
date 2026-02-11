# Repo Split Handoff

Migration of client packages from `runtimed/runtimed` to `runtimed/runt`.

## What's Done

### New Repo (`runtimed/runt`)

- [x] Created repo at https://github.com/runtimed/runt
- [x] Extracted history with `git-filter-repo` — commit history preserved for all client paths
- [x] Cleaned up tags — only `sidecar-*`, `runt-cli-*`, `python-*` tags remain
- [x] Workspace `Cargo.toml` with crates.io deps (no path deps to runtimed)
- [x] Updated `crates/sidecar/Cargo.toml` — `edition.workspace = true`, `license.workspace = true`, crates.io deps
- [x] Updated `crates/runt/Cargo.toml` — same treatment, `sidecar` stays as `path = "../sidecar"`
- [x] `python/runtimed/pyproject.toml` — relative paths preserved, works as-is
- [x] CI workflows: `build.yml`, `weekly-preview.yml`, `python-package.yml`, `ui-lint.yml`
- [x] `README.md`, `RELEASING.md`, `.gitignore`
- [x] `Cargo.lock` checked in (binary repo, not library)
- [x] Local build verified: `cargo build --release` succeeds, `cargo test` passes, `runt --help` works
- [x] Previous CI runs (Build, UI Lint) all green

### Library Publishes (`runtimed/runtimed`)

- [x] `jupyter-protocol` 1.2.0 published to crates.io (adds `with_channel()`)
- [x] `runtimelib` 1.2.0 published to crates.io (adds `_with_identity` APIs, `peer_identity_for_session`)
- [x] Both tagged and pushed

### PyPI Trusted Publishing

- [x] New trusted publisher added on pypi.org for `runtimed/runt` repo
- [x] Version bumped to 0.1.4 in `python/runtimed/pyproject.toml`
- [x] `python-v0.1.4` tag pushed, workflow triggered
- [ ] **VERIFY**: Python Package workflow completes successfully and 0.1.4 appears on https://pypi.org/project/runtimed/

## What's Left

### 1. Confirm PyPI Publish (BLOCKING)

Check https://github.com/runtimed/runt/actions for the Python Package workflow run.
Check https://pypi.org/project/runtimed/#history for version 0.1.4.

**Do NOT proceed to step 2 until this succeeds.** If it fails, debug the workflow — likely a trusted publisher config mismatch (check environment name, workflow filename).

### 2. Clean Up `runtimed/runtimed`

Remove client packages from the original repo:

```bash
cd runtimed
git rm -r crates/sidecar crates/runt
git rm -r packages/sidecar-ui packages/ui
git rm -r python/
git rm package.json pnpm-workspace.yaml pnpm-lock.yaml tailwind.config.js
```

Update `Cargo.toml` workspace members:

```toml
[workspace]
members = [
    "crates/nbformat",
    "crates/runtimelib",
    "crates/jupyter-serde",
    "crates/jupyter-websocket-client",
    "crates/jupyter-protocol",
    "crates/ollama-kernel",
    "crates/mybinder",
]

# default-members can be removed or kept — no more non-default members
```

Remove `default-members` — all remaining crates are publishable libraries.

Commit and push.

### 3. Simplify CI in `runtimed/runtimed`

All workflows become pure Rust — remove Node.js/pnpm setup:

**`clippy.yml`** — remove: Setup Node, Enable corepack, Install JS deps, Build sidecar UI, `apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev`

**`linux.yml`** — remove: Node setup, pnpm, sidecar UI build, `Build sidecar` step, hone-tests job (moves to runt). Remove `apt-get install libgtk-3-dev libwebkit2gtk-4.1-dev`.

**`windows.yml`** — no changes needed (already only tests runtimelib)

**Delete**: `ui-lint.yml`, `weekly-preview.yml`, `python-package.yml` — these all move to runt

### 4. Remove Old Trusted Publisher

After confirming 0.1.4 published from `runtimed/runt`:

1. Go to https://pypi.org/manage/project/runtimed/settings/publishing/
2. Remove `runtimed/runtimed` as a trusted publisher
3. Keep only `runtimed/runt`

### 5. Update `runtimed/runtimed` README

Focus on library usage. Link to `runtimed/runt` for CLI/desktop tools. Something like:

> For the `runt` CLI and sidecar desktop viewer, see [runtimed/runt](https://github.com/runtimed/runt).

### 6. Update `runtimed/runtimed` RELEASING.md

Remove sections about sidecar, runt-cli, and Python package. Keep only the library crate release instructions.

### 7. Install Script

The install script at `https://i.safia.sh/runtimed/runtimed` (referenced in weekly preview releases) needs updating to point to `runtimed/runt` releases instead of `runtimed/runtimed`.

### 8. `runtimed/smoke` Repo

Check https://github.com/runtimed/smoke — verify it doesn't reference sidecar or runt. It should only test library crates and need no changes.

### 9. Notebook UI (Optional, Separate)

The `rgbkrk/notebook-ui-tauri` branch on `runtimed/runtimed` has the notebook crate and UI. To bring it into `runtimed/runt`:

```bash
cd runt
git remote add upstream git@github.com:runtimed/runtimed.git
git fetch upstream rgbkrk/notebook-ui-tauri
git checkout -b add-notebook
git checkout upstream/rgbkrk/notebook-ui-tauri -- crates/notebook packages/notebook-ui
# Update Cargo.toml to add crates/notebook to workspace members
# Update deps from workspace/path to crates.io versions
git commit -m "Add notebook crate and UI"
```

This is independent work and doesn't block the split.

## Build Warnings to Address

In `runtimed/runt`:

1. **Sidecar deprecation warnings** — `create_client_shell_connection` is deprecated in runtimelib 1.2.0. Update sidecar to use `create_client_shell_connection_with_identity` with `peer_identity_for_session`. Three call sites in `crates/sidecar/src/lib.rs` (lines 188, 514, 557).

2. **Dead code warning** — `KernelClient::execute_with_stdin` in `crates/runt/src/kernel_client.rs` line 279. Either use it or allow the warning.

## Key URLs

| Thing | URL |
|-------|-----|
| New repo | https://github.com/runtimed/runt |
| Original repo | https://github.com/runtimed/runtimed |
| PyPI project settings | https://pypi.org/manage/project/runtimed/settings/publishing/ |
| PyPI release history | https://pypi.org/project/runtimed/#history |
| runtimed on crates.io | https://crates.io/crates/runtimelib |
| jupyter-protocol on crates.io | https://crates.io/crates/jupyter-protocol |

## Versions Published During Migration

| Crate | Version | What Changed |
|-------|---------|--------------|
| `jupyter-protocol` | 1.2.0 | `JupyterMessage::with_channel()` |
| `runtimelib` | 1.2.0 | `peer_identity_for_session`, `create_client_{shell,stdin}_connection_with_identity`, old functions deprecated |
| `runtimed` (PyPI) | 0.1.4 | First publish from `runtimed/runt` (test release) |
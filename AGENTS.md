# Agent Instructions

This document provides guidance for AI agents working in this repository.

## Code Formatting (Required Before Committing)

Run these commands before every commit. CI will reject PRs that fail formatting checks.

```bash
# Format Rust code
cargo fmt

# Format and lint TypeScript/JavaScript (auto-fixes issues)
npx @biomejs/biome check --fix apps/notebook/src/ e2e/
```

Do not skip these. There are no pre-commit hooks — you must run them manually.

## Workspace Description

When working in a worktree, set a human-readable description of what you're working on by writing to `.context/workspace-description`:

```bash
mkdir -p .context
echo "Your description here" > .context/workspace-description
```

This description appears in the notebook app's debug banner (visible in debug builds only), helping identify what each worktree is testing when multiple are running in parallel.

Keep descriptions short and descriptive, e.g.:
- "Testing conda environment creation"
- "Fixing kernel interrupt handling"
- "Adding ipywidgets support"

The `.context/` directory is gitignored and used for per-worktree state that shouldn't be committed.

## Contributing Guidelines

See the `contributing/` directory for detailed guides:
- `contributing/development.md` - Development workflow and build commands
- `contributing/e2e.md` - End-to-end testing guide
- `contributing/environments.md` - Environment management architecture
- `contributing/iframe-isolation.md` - Security architecture for output isolation
- `contributing/nteract-elements.md` - Working with nteract/elements registry
- `contributing/ui.md` - UI components and shadcn setup

## Runtime Daemon (`runtimed`)

The notebook app connects to a background daemon (`runtimed`) that manages prewarmed environments, settings sync, and notebook document sync. The daemon runs as a system service (`io.runtimed` on macOS).

**Important:** The daemon is a separate process from the notebook app. When you change code in `crates/runtimed/`, the running daemon still uses the old binary until you reinstall it. This is a common source of "it works in tests but not in the app" confusion.

```bash
# Reinstall daemon with your changes (builds release, stops old, copies, restarts)
cargo xtask install-daemon

# Or manually:
./target/debug/runtimed stop && ./target/debug/runtimed uninstall && ./target/debug/runtimed install
```

`cargo xtask dev` and `cargo xtask build` do **not** reinstall the daemon. If you're changing daemon code (settings, sync, environments), you must run `cargo xtask install-daemon` separately to test your changes.

See `docs/runtimed.md` for service management and troubleshooting.

### Daemon Logs

The daemon logs to:
```
~/Library/Caches/runt/runtimed.log
```

To check daemon logs:
```bash
tail -100 ~/Library/Caches/runt/runtimed.log
```

To check which daemon version is running:
```bash
cat ~/Library/Caches/runt/daemon.json
```

## Environment Management

Runt supports multiple environment backends (UV, Conda) and project file formats (pyproject.toml, environment.yml, pixi.toml). See `contributing/environments.md` for the full architecture and `docs/environments.md` for the user-facing guide.

### Detection Priority Chain

When a notebook has no inline dependencies, `start_default_python_kernel_impl` in `crates/notebook/src/lib.rs` uses **closest-wins** project file detection via `project_file::find_nearest_project_file`:

1. **Inline deps in notebook metadata** (uv or conda) — use those directly
2. **Closest project file** — single walk-up from the notebook directory, checking for `pyproject.toml`, `pixi.toml`, and `environment.yml` at each level. The first (closest) match wins. Same-directory tiebreaker: pyproject.toml > pixi.toml > environment.yml
3. **No project file** — use prewarmed env based on user preference

The walk-up stops at `.git` boundaries and the home directory, preventing cross-repository project file pollution.

Deno has a parallel chain: `deno.json`/`deno.jsonc` detection triggers the Deno kernel. It's separate but the same invariant applies.

**Key invariant: the frontend defers to the backend for project file detection.** The frontend (`useKernel.ts`) handles inline deps and Deno runtime detection, then calls `startDefaultKernel()` which delegates all project file detection to the backend. This avoids duplicating the detection chain across frontend and backend.

### Environment Source Labels

The backend returns an `env_source` string with the `kernel:lifecycle` event so the frontend can display the environment origin. Values:

- `"uv:inline"` / `"uv:pyproject"` / `"uv:prewarmed"`
- `"conda:inline"` / `"conda:env_yml"` / `"conda:pixi"` / `"conda:prewarmed"`

### Adding a New Project File Format

Follow the pattern established by `environment_yml.rs` and `pixi.rs`:

1. Create `crates/notebook/src/{format}.rs` with `find_{format}()` (directory walk) and `parse_{format}()` functions
2. Add Tauri commands in `lib.rs`: `detect_{format}`, `get_{format}_dependencies`, `import_{format}_dependencies`
3. Wire detection into `start_default_python_kernel_impl` at the correct priority position
4. Add frontend detection in `useKernel.ts` auto-launch and `useCondaDependencies.ts` or `useDependencies.ts`
5. Add test fixture in `crates/notebook/fixtures/audit-test/`

### Trust System

Dependencies are signed with HMAC-SHA256 using a per-machine key at `~/.config/runt/trust-key`. The signature covers `metadata.uv` and `metadata.conda` only (not cell contents or outputs). Shared notebooks are always untrusted on a new machine because the key is machine-specific. If you change the dependency metadata structure, you must update `crates/notebook/src/trust.rs`.

### Key Files

| File | Role |
|------|------|
| `crates/notebook/src/lib.rs` | Tauri commands, kernel launch orchestration |
| `crates/notebook/src/project_file.rs` | Unified closest-wins project file detection |
| `crates/notebook/src/kernel.rs` | Kernel process management |
| `crates/notebook/src/uv_env.rs` | UV environment creation and caching |
| `crates/notebook/src/conda_env.rs` | Conda environment creation via rattler |
| `crates/notebook/src/env_pool.rs` | Prewarmed environment pool |
| `crates/notebook/src/pyproject.rs` | pyproject.toml discovery and parsing |
| `crates/notebook/src/pixi.rs` | pixi.toml discovery and parsing |
| `crates/notebook/src/environment_yml.rs` | environment.yml discovery and parsing |
| `crates/notebook/src/deno_env.rs` | Deno config detection and version checking |
| `crates/notebook/src/trust.rs` | HMAC trust verification |
| `apps/notebook/src/hooks/useKernel.ts` | Frontend kernel lifecycle and auto-launch |
| `apps/notebook/src/hooks/useDependencies.ts` | Frontend UV dependency management |
| `apps/notebook/src/hooks/useCondaDependencies.ts` | Frontend conda dependency management |

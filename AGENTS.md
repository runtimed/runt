# Agent Instructions

This document provides guidance for AI agents working in this repository.

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

## Environment Management

Runt supports multiple environment backends (UV, Conda) and project file formats (pyproject.toml, environment.yml, pixi.toml). See `contributing/environments.md` for the full architecture and `docs/environments.md` for the user-facing guide.

### Detection Priority Chain

When a notebook has no inline dependencies, `start_default_python_kernel_impl` in `crates/notebook/src/lib.rs` checks for project files in this order:

1. **Inline deps in notebook metadata** (uv or conda) — use those directly
2. **pyproject.toml** near notebook — start kernel via `uv run`
3. **pixi.toml** near notebook — convert to conda deps, use rattler
4. **environment.yml** near notebook — use conda with parsed deps
5. **No project file** — use prewarmed env based on user preference

Deno has a parallel chain: `deno.json`/`deno.jsonc` detection triggers the Deno kernel. It's separate but the same invariant applies.

**Key invariant: the backend and frontend detection chains must agree on priority order.** The backend decides in `start_default_python_kernel_impl` (lib.rs). The frontend detects in `useKernel.ts` (auto-launch logic). If these diverge, users get unexpected environments.

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

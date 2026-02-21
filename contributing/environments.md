# Environment Management Architecture

This guide covers how Runt creates and manages Python and Deno environments for notebooks.

## Overview

When a user opens a notebook, Runt needs to provide a kernel with the right packages installed. The system supports multiple environment creation paths depending on the notebook's metadata and surrounding project files.

```
Notebook opened
  │
  ├─ Has inline deps? ──────────────── Use UV or Conda with those deps
  │
  ├─ Closest project file?             (walk up from notebook, stop at .git / home)
  │   ├─ pyproject.toml ─────────────── Use `uv run` (project's .venv)
  │   ├─ pixi.toml ──────────────────── Convert to conda deps, use rattler
  │   └─ environment.yml ────────────── Use conda with parsed deps
  │
  └─ Nothing found ────────────────── Claim prewarmed env from pool
```

## Detection Priority Chain

The backend decides which environment to use in `start_default_python_kernel_impl` (`crates/notebook/src/lib.rs`):

| Priority | Source | Backend | Environment Type |
|----------|--------|---------|-----------------|
| 1 | Inline notebook metadata | uv or conda deps from `metadata.uv` / `metadata.conda` | Cached by dep hash |
| 2 | Closest project file | Single walk-up via `project_file::find_nearest_project_file` | Depends on file type |
| 3 | User preference | Prewarmed UV or Conda env from pool | Shared pool env |

For step 2, the walk-up checks for `pyproject.toml`, `pixi.toml`, and `environment.yml`/`environment.yaml` at **each directory level**, starting from the notebook's location. The first (closest) match wins. When multiple project files exist in the same directory, the tiebreaker order is: pyproject.toml > pixi.toml > environment.yml.

The walk-up stops at `.git` boundaries and the user's home directory, preventing cross-repository project file pollution.

| Project file | Backend | Environment Type |
|-------------|---------|-----------------|
| `pyproject.toml` | `uv run --with ipykernel` in project dir | Project `.venv/` |
| `pixi.toml` | Convert pixi deps to `CondaDependencies`, use rattler | Cached by dep hash |
| `environment.yml` | Parse deps, use rattler | Cached by dep hash |

**Key invariant**: The frontend (`useKernel.ts`) handles inline deps and Deno detection, then defers all project file detection to the backend via `startDefaultKernel()`. This avoids duplicating the detection chain across frontend and backend.

Deno has a separate chain: `deno.json`/`deno.jsonc` detection triggers the Deno runtime. See `crates/notebook/src/deno_env.rs`.

## Content-Addressed Caching

Environments are cached by a hash of their dependencies so notebooks with identical deps share a single environment.

**UV** (`uv_env.rs`):
- Hash = SHA256(sorted deps + requires_python + env_id), first 16 hex chars
- Location: `~/.cache/runt/envs/{hash}/`
- When deps are non-empty, env_id is excluded from hash (allows cross-notebook sharing)
- When deps are empty, env_id is included (per-notebook isolation)

**Conda** (`conda_env.rs`):
- Hash = SHA256(sorted deps + sorted channels + python version + env_id), first 16 hex chars
- Location: `~/.cache/runt/conda-envs/{hash}/`

Cache hit check: verify that `{hash}/bin/python` (Unix) or `{hash}/Scripts/python.exe` (Windows) exists.

## Prewarming and the Daemon Pool

To make notebook startup instant, Runt maintains a pool of pre-created environments with just `ipykernel` and `ipywidgets` installed.

**In-process pool** (`env_pool.rs`):
- Default size: 3 environments
- Max age: 2 days (172800 seconds)
- Maintained as `Vec<PrewarmedEnv>` in `EnvPool`

**Daemon pool** (`crates/runtimed/`):
- The `runtimed` daemon runs as a background process
- Manages its own environment pool across notebook windows
- Accessed via `runtimed::client::try_get_pooled_env()`
- Falls back to in-process pool if daemon is unavailable

Prewarmed environments have no `env_id` so they can be reused by any notebook that needs a bare environment.

## Project File Discovery

The unified project file detection lives in `project_file.rs` and is used by `start_default_python_kernel_impl` for kernel launch decisions:

| Module | Purpose |
|--------|---------|
| `project_file.rs` | `find_nearest_project_file()` — single walk-up checking all project file types at each level, closest wins |

Individual project file modules still exist for parsing, Tauri detection commands, and the dependency management UI:

| Module | File | Function |
|--------|------|----------|
| `pyproject.rs` | `pyproject.toml` | `find_pyproject()`, parsing, Tauri commands |
| `pixi.rs` | `pixi.toml` | `find_pixi_toml()`, parsing, Tauri commands |
| `environment_yml.rs` | `environment.yml` / `environment.yaml` | `find_environment_yml()`, parsing, Tauri commands |
| `deno_env.rs` | `deno.json` / `deno.jsonc` | `find_deno_config()` |

All walk-up functions (both unified and individual) stop at `.git` boundaries and the user's home directory.

Each per-format module provides:
- A parse function to extract dependencies
- Tauri commands for frontend detection (`detect_*`), dependency listing (`get_*_dependencies`), and import (`import_*_dependencies`)

## Notebook Metadata Schema

Dependencies and environment config are stored in notebook JSON metadata:

```json
{
  "metadata": {
    "runt": {
      "env_id": "uuid",
      "runtime": "python"
    },
    "uv": {
      "dependencies": ["pandas", "numpy"],
      "requires-python": ">=3.10"
    },
    "conda": {
      "dependencies": ["numpy", "scipy"],
      "channels": ["conda-forge"],
      "python": "3.12"
    },
    "deno": {
      "permissions": ["--allow-net", "--allow-read"],
      "config": "deno.json"
    }
  }
}
```

`runt.env_id` is the canonical per-notebook identifier used for environment isolation.

## Trust System

Dependencies are signed with HMAC-SHA256 to prevent untrusted code execution on notebook open.

- **Key**: 32 random bytes stored at `~/.config/runt/trust-key`, generated on first use
- **Signed content**: Canonical JSON of `metadata.uv` + `metadata.conda` (not cell contents or outputs)
- **Signature format**: `"hmac-sha256:{hex_digest}"` stored in notebook metadata
- **Machine-specific**: The key is per-machine, so every shared notebook is untrusted on the recipient's machine
- **Verification**: `trust.rs:verify_signature()` returns `TrustStatus`: Trusted, Untrusted, SignatureInvalid, or NoDependencies

Changes to the dependency metadata structure require updating the signing logic in `crates/notebook/src/trust.rs`.

## Frontend Architecture

Two parallel UI components manage dependencies:

| Component | Hook | Manages |
|-----------|------|---------|
| `DependencyHeader.tsx` | `useDependencies.ts` | UV deps, pyproject.toml detection |
| `CondaDependencyHeader.tsx` | `useCondaDependencies.ts` | Conda deps, environment.yml and pixi.toml detection |

The kernel lifecycle is managed by `useKernel.ts`, which:
- Listens for `kernel:lifecycle` events from the backend
- Captures the `env_source` string (e.g. `"uv:pyproject"`, `"conda:pixi"`)
- Runs auto-launch detection on notebook open

## Testing

**Unit tests**: Each project file module has thorough tests. `environment_yml.rs` is the best exemplar — it covers discovery logic, parsing edge cases, and conversion to `CondaDependencies`.

**Test fixtures**: `crates/notebook/fixtures/audit-test/` contains numbered test notebooks:
- `1-vanilla.ipynb` — no dependencies
- `2-uv-inline.ipynb` — inline UV dependencies
- `3-conda-inline.ipynb` — inline conda dependencies
- `4-both-deps.ipynb` — both UV and conda
- `pyproject-project/5-pyproject.ipynb` — notebook next to pyproject.toml
- `pixi-project/6-pixi.ipynb` — notebook next to pixi.toml
- `conda-env-project/7-environment-yml.ipynb` — notebook next to environment.yaml

**E2E tests**: `e2e/specs/` contains WebDriverIO tests that build the app and verify kernel startup with each environment type. See `contributing/e2e.md` for the E2E testing guide.

## Key Files

| File | Role |
|------|------|
| `crates/notebook/src/lib.rs` | Tauri commands, `start_default_python_kernel_impl` |
| `crates/notebook/src/project_file.rs` | Unified closest-wins project file detection |
| `crates/notebook/src/kernel.rs` | Kernel process management, `start_with_uv`/`start_with_conda`/`start_with_uv_run` |
| `crates/notebook/src/uv_env.rs` | UV environment creation, dep hashing, caching |
| `crates/notebook/src/conda_env.rs` | Conda environment creation via rattler |
| `crates/notebook/src/env_pool.rs` | Prewarmed environment pool (daemon + in-process) |
| `crates/notebook/src/pyproject.rs` | pyproject.toml discovery and parsing |
| `crates/notebook/src/pixi.rs` | pixi.toml discovery and parsing |
| `crates/notebook/src/environment_yml.rs` | environment.yml discovery and parsing |
| `crates/notebook/src/deno_env.rs` | Deno config detection |
| `crates/notebook/src/notebook_state.rs` | Notebook metadata and new notebook creation |
| `crates/notebook/src/settings.rs` | User preferences (default runtime, env type) |
| `crates/notebook/src/trust.rs` | HMAC trust verification |
| `crates/runtimed/src/daemon.rs` | Background daemon pool management |
| `apps/notebook/src/hooks/useKernel.ts` | Frontend kernel lifecycle and auto-launch |
| `apps/notebook/src/hooks/useDependencies.ts` | Frontend UV dep management |
| `apps/notebook/src/hooks/useCondaDependencies.ts` | Frontend conda dep management |
| `apps/notebook/src/components/DependencyHeader.tsx` | UV dependency UI panel |
| `apps/notebook/src/components/CondaDependencyHeader.tsx` | Conda dependency UI panel |

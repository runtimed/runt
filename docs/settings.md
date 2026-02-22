# Settings

Runt notebook settings control default behavior for new notebooks, appearance, and runtime configuration.

## Quick Reference

| Setting | Options | Default | Stored In |
|---------|---------|---------|-----------|
| Theme | light, dark, system | system | Synced (Automerge) + localStorage for FOUC |
| Default runtime | python, deno | python | Synced (Automerge) + settings file |
| Default Python env | uv, conda | uv | Synced (Automerge) + settings file |
| Default uv packages | comma-separated list | (empty) | Synced (Automerge) + settings file |
| Default conda packages | comma-separated list | (empty) | Synced (Automerge) + settings file |

## How Settings Sync Works

Settings are synced across all notebook windows via the runtimed daemon using Automerge. The daemon holds the canonical document; each notebook window maintains a local replica.

- **Source of truth:** The Automerge document in the daemon
- **Persistence:** Settings are also written to `settings.json` as a local fallback (for Cmd+N menu behavior and daemon-unavailable scenarios)
- **Theme special case:** Theme also uses browser localStorage to prevent a flash of unstyled content on startup

When you change a setting in any window, it propagates to all other open windows in real time.

## Settings File

Settings are persisted to a JSON file shared across all notebook windows.

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/runt-notebook/settings.json` |
| Linux | `~/.config/runt-notebook/settings.json` |
| Windows | `C:\Users\<User>\AppData\Roaming\runt-notebook\settings.json` |

The file is created automatically when you first change a setting. You can also create or edit it by hand.

Example:

```json
{
  "default_runtime": "python",
  "default_python_env": "uv",
  "default_uv_packages": "numpy, pandas, matplotlib",
  "default_conda_packages": "numpy, pandas, scikit-learn"
}
```

## Theme

Controls light/dark appearance for the notebook editor and output viewer.

- **Light** — forces light mode
- **Dark** — forces dark mode
- **System** — follows your OS preference and updates automatically when it changes

Change the theme by clicking the gear icon in the notebook toolbar, then selecting Light, Dark, or System.

## Default Runtime

Determines which runtime is used when creating a new notebook with **Cmd+N** (or **Ctrl+N** on Windows/Linux).

```json
{
  "default_runtime": "python"
}
```

Valid values: `"python"`, `"deno"`

You can always create a notebook with a specific runtime using the **File > New Notebook As...** submenu.

## Default Python Environment

Controls which package manager is used for Python notebooks when no project-level configuration is detected.

```json
{
  "default_python_env": "uv"
}
```

Valid values: `"uv"`, `"conda"`

- **uv** — uses uv for package management (fast, pip-compatible)
- **conda** — uses conda/rattler for package management (supports conda packages)

If the notebook directory contains a `pyproject.toml` or `environment.yml`, the environment type is determined by that file instead of this setting.

## Default Packages

Controls which packages are pre-installed in prewarmed environments. These packages are available immediately when you open a new notebook, without needing to add them as inline dependencies.

Since uv and conda have different package ecosystems, packages are configured separately:

```json
{
  "default_uv_packages": "numpy, pandas, matplotlib",
  "default_conda_packages": "numpy, pandas, scikit-learn"
}
```

Both fields accept a comma-separated list of package names. Changes take effect on the next pool replenishment cycle — existing prewarmed environments keep their original packages until replaced. Restarting the app clears the pool and rebuilds with the updated packages.

The packages are installed alongside `ipykernel` and `ipywidgets` (which are always included).

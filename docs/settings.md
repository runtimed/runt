# Settings

Runt notebook settings control default behavior for new notebooks, appearance, and runtime configuration.

## Quick Reference

| Setting | Options | Default | Stored In |
|---------|---------|---------|-----------|
| Theme | light, dark, system | system | Browser localStorage (per window) |
| Default runtime | python, deno | python | Settings file |
| Default Python env | uv, conda | conda | Settings file |
| Default Deno permissions | Deno permission flags | none | Settings file |

## Settings File

Most settings are stored in a JSON file that is shared across all notebook windows.

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
  "default_python_env": "conda",
  "default_deno_permissions": []
}
```

## Theme

Controls light/dark appearance for the notebook editor and output viewer.

- **Light** — forces light mode
- **Dark** — forces dark mode
- **System** — follows your OS preference and updates automatically when it changes

Change the theme by clicking the gear icon in the notebook toolbar, then selecting Light, Dark, or System.

Theme is currently stored per window in browser localStorage. Changing the theme in one window does not affect other open windows.

## Default Runtime

Determines which runtime is used when creating a new notebook with **Cmd+N** (or **Ctrl+N** on Windows/Linux).

```json
{
  "default_runtime": "python"
}
```

Valid values: `"python"`, `"deno"`

You can always create a notebook with a specific runtime regardless of this setting:

- **Cmd+N** — new notebook with the default runtime
- **Cmd+Shift+N** — new Deno (TypeScript) notebook
- `runt notebook --runtime deno` — from the CLI

## Default Python Environment

Controls which package manager is used for Python notebooks when no project-level configuration is detected.

```json
{
  "default_python_env": "conda"
}
```

Valid values: `"uv"`, `"conda"`

- **conda** — uses conda/rattler for package management (supports conda packages)
- **uv** — uses uv for package management (fast, pip-compatible)

If the notebook directory contains a `pyproject.toml` or `environment.yml`, the environment type is determined by that file instead of this setting.

## Default Deno Permissions

Specifies default permission flags applied to new Deno notebooks.

```json
{
  "default_deno_permissions": ["--allow-net", "--allow-read"]
}
```

By default this is an empty array, meaning Deno notebooks run with no extra permissions. See the [Deno permissions documentation](https://docs.deno.com/runtime/fundamentals/security/) for available flags.


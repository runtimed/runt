# Runtime Daemon

The runtime daemon (`runtimed`) manages prewarmed Python environments in the background, making notebook startup faster.

## How It Works

When you open a notebook, it needs a Python environment with ipykernel installed. Creating this environment takes time. The daemon solves this by keeping a pool of ready-to-use environments:

1. Daemon runs in the background, maintaining warm environments
2. When you open a notebook, it instantly gets an environment from the pool
3. The daemon replenishes the pool for next time

This is especially useful when opening multiple notebooks quickly - each one gets a pre-warmed environment without waiting.

## Status

Check if the daemon is running:

```bash
runt pool status
```

Example output:
```
Pool Daemon Status
==================
UV environments:
  Available: 3
  Warming:   0
Conda environments:
  Available: 2
  Warming:   1
```

## Service Management

The daemon runs as a system service that starts automatically at login.

### macOS

```bash
# Check status
launchctl list | grep runtimed

# Stop
launchctl stop io.runtimed

# Start
launchctl start io.runtimed

# View logs
tail -f ~/Library/Caches/runt/runtimed.log
```

### Linux

```bash
# Check status
systemctl --user status runtimed

# Stop
systemctl --user stop runtimed

# Start
systemctl --user start runtimed

# View logs
journalctl --user -u runtimed -f
```

## Troubleshooting

### Notebook taking a long time to start?

Check if the daemon is running and has environments available:

```bash
runt pool status
```

If the pool shows 0 available, the daemon might be warming up. Wait a moment and try again.

### Daemon not starting?

Check for a stale lock file:

```bash
# View daemon info
cat ~/.cache/runt/daemon.json

# If the daemon crashed, you may need to remove stale files
rm ~/.cache/runt/daemon.lock ~/.cache/runt/daemon.json
```

### Environments not being created?

For UV environments, ensure `uv` is installed:
```bash
uv --version
```

For Conda environments, check the daemon logs:
```bash
tail -f ~/Library/Caches/runt/runtimed.log  # macOS
```

## File Locations

| File | Purpose |
|------|---------|
| `~/.cache/runt/runtimed.sock` | IPC socket |
| `~/.cache/runt/daemon.json` | Daemon status info |
| `~/.cache/runt/runtimed.log` | Log file (service mode) |
| `~/.cache/runt/envs/` | Prewarmed environments |

## FAQ

### Do I need the daemon for notebooks to work?

No. The notebook app works fine without the daemon - it will create environments on demand. The daemon just makes things faster by having environments ready.

### How many environments does it keep?

By default, 3 UV environments and 3 Conda environments. This can be configured when running the daemon manually.

### Does it use a lot of disk space?

Each UV environment is small (~50MB). Conda environments are larger (~500MB+) because they include more packages. Environments older than 2 days are automatically cleaned up.

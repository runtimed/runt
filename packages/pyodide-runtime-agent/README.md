# Pyodide Runtime Agent

A Pyodide-based Python runtime agent for the Runt notebook system.

## Features

- Python execution using Pyodide in a web worker
- Rich display support for matplotlib, pandas, and other visualization libraries
- IPython-style environment with magic commands and tab completion
- Package management with micropip
- True interruption support via SharedArrayBuffer
- **Host directory mounting** for accessing local files and data

## Usage

### Basic Usage

```bash
deno run --allow-all "jsr:@runt/pyodide-runtime-agent" \
  --notebook my-notebook \
  --auth-token your-token
```

### Mounting Host Directories

You can mount host directories into the Pyodide runtime filesystem to access local files and data from your Python cells:

```bash
deno run --allow-all "jsr:@runt/pyodide-runtime-agent" \
  --notebook my-notebook \
  --auth-token your-token \
  --mount /path/to/your/data \
  --mount /path/to/your/scripts
```

Host directories are mounted under `/mnt/` with sanitized names. For example:
- `/home/user/data` becomes `/mnt/_home_user_data`
- `/Users/john/projects` becomes `/mnt/_Users_john_projects`

#### Read-Only Mounting

For security and data protection, you can mount directories as read-only to prevent Python code from modifying the original files:

```bash
deno run --allow-all "jsr:@runt/pyodide-runtime-agent" \
  --notebook my-notebook \
  --auth-token your-token \
  --mount /path/to/important/data \
  --mount-readonly
```

When `--mount-readonly` is specified, all mounted files and directories will be set with read-only permissions. This prevents:
- Modifying existing files
- Deleting existing files  
- Creating new files
- Creating new directories
- Deleting directories

Any attempt to perform these operations from Python will result in a `PermissionError` or `OSError`.

### Using Mounted Directories in Python

Once mounted, you can access your host files from Python cells:

```python
import os
import pandas as pd

# List mounted directories
print("Mounted directories:")
for item in os.listdir("/mnt"):
    print(f"  /mnt/{item}")

# Read data from mounted directory
df = pd.read_csv("/mnt/_home_user_data/my_dataset.csv")
print(df.head())

# Save results back to mounted directory (only works if not mounted read-only)
df.processed = df.apply(some_processing_function, axis=1)
df.to_csv("/mnt/_home_user_data/processed_dataset.csv", index=False)

# When using --mount-readonly, write operations will fail:
# try:
#     df.to_csv("/mnt/_home_user_data/new_file.csv", index=False)
# except PermissionError:
#     print("Cannot write to read-only mounted directory")
#     # Use /outputs directory instead for saving results
#     df.to_csv("/outputs/processed_dataset.csv", index=False)
```

### Output Directory Syncing

You can specify a host directory where files from the Pyodide `/outputs` directory will be automatically synced after each cell execution:

```bash
deno run --allow-all "jsr:@runt/pyodide-runtime-agent" \
  --notebook my-notebook \
  --auth-token your-token \
  --output-dir /path/to/output/directory
```

Files created in `/outputs` within Python cells will be automatically copied to the specified host directory, preserving the directory structure:

```python
import pandas as pd
import matplotlib.pyplot as plt

# Create some data
df = pd.DataFrame({'x': range(10), 'y': [x**2 for x in range(10)]})

# Save to /outputs - will be synced to host automatically
df.to_csv('/outputs/results.csv', index=False)

# Create a plot and save it
plt.figure(figsize=(8, 6))
plt.plot(df['x'], df['y'])
plt.title('Quadratic Function')
plt.savefig('/outputs/plot.png')

# Create nested directories
import os
os.makedirs('/outputs/analysis', exist_ok=True)
with open('/outputs/analysis/summary.txt', 'w') as f:
    f.write(f'Dataset has {len(df)} rows')
```

### Command Line Options

- `--mount <path>` or `-m <path>`: Mount a host directory (can be specified multiple times)
- `--mount-readonly`: Mount directories as read-only (prevents modification)
- `--output-dir <path>`: Host directory to sync `/outputs` to after each cell execution
- `--notebook <id>` or `-n <id>`: Notebook ID to connect to
- `--auth-token <token>` or `-t <token>`: Authentication token
- `--sync-url <url>`: WebSocket URL for LiveStore sync
- `--runtime-id <id>`: Runtime identifier
- `--help` or `-h`: Show help message

### Environment Variables

You can also use environment variables instead of command line arguments:

- `NOTEBOOK_ID`: Notebook ID
- `AUTH_TOKEN`: Authentication token  
- `LIVESTORE_SYNC_URL`: Sync URL
- `RUNTIME_ID`: Runtime identifier

## Security Considerations

The `--mount` feature requires file system access permissions. When using mounted directories:

- Only mount directories you trust and need access to
- Be cautious when running untrusted code that might access mounted directories
- Consider using read-only bind mounts on your system if you only need read access

## Examples

### Data Analysis Workflow

```bash
# Mount your data and scripts directories
deno run --allow-all "jsr:@runt/pyodide-runtime-agent" \
  --notebook data-analysis \
  --auth-token your-token \
  --mount /home/user/datasets \
  --mount /home/user/analysis-scripts
```

```python
# In your notebook cell
import sys
sys.path.append('/mnt/_home_user_analysis_scripts')

import my_analysis_utils
import pandas as pd

# Load data from mounted directory
data = pd.read_csv('/mnt/_home_user_datasets/sales_data.csv')

# Perform analysis using your custom utilities
results = my_analysis_utils.analyze_sales_trends(data)

# Save results back to mounted directory
results.to_csv('/mnt/_home_user_datasets/analysis_results.csv')
```

This allows you to seamlessly work with local files and maintain your analysis workflows while leveraging the power of the Runt notebook environment.

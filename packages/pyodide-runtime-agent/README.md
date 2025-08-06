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

# Save results back to mounted directory
df.processed = df.apply(some_processing_function, axis=1)
df.to_csv("/mnt/_home_user_data/processed_dataset.csv", index=False)
```

### Command Line Options

- `--mount <path>` or `-m <path>`: Mount a host directory (can be specified multiple times)
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

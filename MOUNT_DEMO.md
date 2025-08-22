# Host Directory Mounting Demo

This demo shows how to use the new `--mount` functionality to access host
directories from within Pyodide Python cells. The implementation copies files
from host directories into the Pyodide virtual filesystem at startup.

## How It Works

When you specify `--mount /path/to/directory`, the Pyodide runtime agent:

1. **Reads** all files recursively from the host directory using Deno's
   filesystem APIs
2. **Copies** the file contents into the Pyodide virtual filesystem under
   `/mnt/`
3. **Creates** the directory structure to match the original layout

This approach works in any environment (Node.js, Deno, browsers) and doesn't
require special browser permissions.

## Setup

1. Create a test directory with some data:

```bash
mkdir -p /tmp/runt-demo-data
echo "name,age,city" > /tmp/runt-demo-data/sample.csv
echo "Alice,30,New York" >> /tmp/runt-demo-data/sample.csv
echo "Bob,25,San Francisco" >> /tmp/runt-demo-data/sample.csv
echo "Charlie,35,Chicago" >> /tmp/runt-demo-data/sample.csv

echo "print('Hello from mounted script!')" > /tmp/runt-demo-data/helper.py
```

2. Create a scripts directory:

```bash
mkdir -p /tmp/runt-demo-scripts
cat > /tmp/runt-demo-scripts/analysis.py << 'EOF'
import pandas as pd

def analyze_data(df):
    """Simple data analysis function"""
    return {
        'count': len(df),
        'avg_age': df['age'].mean(),
        'cities': df['city'].unique().tolist()
    }
EOF
```

## Running the Pyodide Agent with Mounted Directories

### Standard (Writable) Mounting

```bash
deno run --allow-all "jsr:@runt/pyodide-runtime-agent" \
  --notebook demo-notebook \
  --auth-token demo-token \
  --mount /tmp/runt-demo-data \
  --mount /tmp/runt-demo-scripts
```

### Read-Only Mounting (Recommended for Data Protection)

```bash
deno run --allow-all "jsr:@runt/pyodide-runtime-agent" \
  --notebook demo-notebook \
  --auth-token demo-token \
  --mount /tmp/runt-demo-data \
  --mount /tmp/runt-demo-scripts \
  --mount-readonly
```

With `--mount-readonly`, all mounted files will be protected from modification,
ensuring your original data remains unchanged.

You should see log messages like:

```
Read 3 files from mount path: /tmp/runt-demo-data
Read 1 files from mount path: /tmp/runt-demo-scripts
Mounting 2 host directories...
Successfully mounted '/tmp/runt-demo-data' at '/mnt/_tmp_runt-demo-data' with 3 files (read-only)
Successfully mounted '/tmp/runt-demo-scripts' at '/mnt/_tmp_runt-demo-scripts' with 1 files (read-only)
```

## Using Mounted Directories in Python Cells

Once the agent is running, you can use the mounted directories in your Python
notebook cells:

### Cell 1: Explore mounted directories

```python
import os

print("Available mounted directories:")
for item in os.listdir("/mnt"):
    print(f"  /mnt/{item}")
    
print("\nContents of data directory:")
for item in os.listdir("/mnt/_tmp_runt-demo-data"):
    print(f"  {item}")
```

### Cell 2: Load and analyze data

```python
import pandas as pd
import sys

# Add the scripts directory to Python path
sys.path.append('/mnt/_tmp_runt-demo-scripts')

# Import our custom analysis function
from analysis import analyze_data

# Read data from mounted directory
df = pd.read_csv('/mnt/_tmp_runt-demo-data/sample.csv')
print("Original data:")
print(df)

# Analyze the data
results = analyze_data(df)
print("\nAnalysis results:")
for key, value in results.items():
    print(f"  {key}: {value}")
```

### Cell 3: Save results (behavior depends on mount mode)

```python
# Create a summary
summary_df = pd.DataFrame([results])

# If mounted as read-only, this will fail with PermissionError
try:
    summary_df.to_csv('/mnt/_tmp_runt-demo-data/analysis_summary.csv', index=False)
    print("Summary saved to mounted directory")
except PermissionError:
    print("Cannot write to read-only mount - saving to /outputs instead")
    summary_df.to_csv('/outputs/analysis_summary.csv', index=False)
    print("Summary saved to /outputs directory")

# Also test other operations that will fail with read-only mounts
try:
    import os
    os.mkdir('/mnt/_tmp_runt-demo-data/new_folder')
    print("Directory created in mount")
except PermissionError:
    print("Cannot create directories in read-only mount")
    os.makedirs('/outputs/new_folder', exist_ok=True)
    print("Directory created in /outputs instead")

# Note: Files saved to mounted directories (if writable) are not automatically 
# written back to the host - this is by design for security
```

### Cell 4: Execute mounted script

```python
# Execute a script from the mounted directory
exec(open('/mnt/_tmp_runt-demo-data/helper.py').read())
```

## Mount Path Naming Convention

Host directories are mounted under `/mnt/` with sanitized names:

| Host Path                | Mount Point                   |
| ------------------------ | ----------------------------- |
| `/tmp/runt-demo-data`    | `/mnt/_tmp_runt-demo-data`    |
| `/tmp/runt-demo-scripts` | `/mnt/_tmp_runt-demo-scripts` |
| `/home/user/projects`    | `/mnt/_home_user_projects`    |
| `/Users/john/data files` | `/mnt/_Users_john_data_files` |

Special characters are replaced with underscores to ensure valid filesystem
paths.

## Important Notes

### Read-Only Nature

- **Files are copied** into the virtual filesystem at startup
- **Changes made** to files in `/mnt/` don't affect the original host files
- **New files created** in `/mnt/` exist only in the virtual filesystem
- This is **by design** for security and isolation

### Performance Considerations

- **Large directories** may take time to copy during initialization
- **File changes** on the host after startup won't be reflected in `/mnt/`
- Consider mounting only the directories you actually need

### Use Cases

This approach is ideal for:

- **Reading configuration files** and data
- **Loading Python modules** and scripts
- **Processing datasets** that don't change during execution
- **Accessing reference data** and documentation

## Security Notes

- Only mount directories you trust and need access to
- Files are copied into an isolated virtual filesystem
- Changes in the virtual filesystem don't affect the host
- Be cautious with large directories as they consume memory

## Cleanup

After testing, you can clean up the demo directories:

```bash
rm -rf /tmp/runt-demo-data /tmp/runt-demo-scripts
```

## Benefits

This mounting functionality enables:

- **Data Pipeline Integration**: Access local datasets for analysis
- **Code Reuse**: Import existing Python modules and scripts
- **Workflow Continuity**: Work with existing file-based workflows
- **Development Efficiency**: Test and iterate without manual file copying
- **Security**: Isolated virtual filesystem prevents accidental host
  modifications
- **Data Protection**: Read-only mounting ensures important data cannot be
  modified accidentally
- **Safe Experimentation**: Work with production data safely using read-only
  mounts

### Read-Only Mounting Benefits

Using `--mount-readonly` provides additional safety:

- **Prevents Data Corruption**: Original files cannot be accidentally modified
  or deleted
- **Prevents File System Pollution**: New files and directories cannot be
  created in mounted locations
- **Enables Safe Production Data Access**: Work with live datasets without risk
- **Enforces Good Practices**: Encourages using `/outputs` for results instead
  of modifying inputs
- **Reduces Security Risks**: Limits potential damage from untrusted or
  experimental code
- **Maintains Data Integrity**: Ensures reproducible analysis with unchanged
  source data
- **Complete Directory Protection**: Both files and directories are protected
  from all write operations

The mount feature bridges the gap between local development and notebook-based
data analysis, making Runt a powerful tool for both exploration and production
data workflows.

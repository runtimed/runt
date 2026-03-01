# Python Bindings (runtimed)

The `runtimed` Python package provides programmatic access to the notebook daemon. Use it to execute code, manage kernels, and interact with notebooks from Python scripts, agents, or automation workflows.

## Installation

```bash
# From PyPI (when published)
pip install runtimed

# From source
cd python/runtimed
uv run maturin develop
```

## Quick Start

```python
import runtimed

# Execute code with automatic kernel management
with runtimed.Session() as session:
    session.start_kernel()
    result = session.run("print('hello')")
    print(result.stdout)  # "hello\n"
```

## Session API

The `Session` class is the primary interface for executing code. Each session connects to a notebook room in the daemon.

### Creating a Session

```python
# Auto-generated notebook ID
session = runtimed.Session()

# Explicit notebook ID (allows sharing between sessions)
session = runtimed.Session(notebook_id="my-notebook")
```

### Kernel Lifecycle

```python
session.connect()                    # Connect to daemon (auto-called by start_kernel)
session.start_kernel()               # Launch Python kernel
session.start_kernel(kernel_type="deno")  # Launch Deno kernel
session.interrupt()                  # Interrupt running execution
session.shutdown_kernel()            # Stop the kernel
```

### Code Execution

```python
# Simple execution (creates ephemeral cell, executes, returns result)
result = session.run("x = 42")
result = session.run("print(x)")

# Check results
print(result.success)         # True if no error
print(result.stdout)          # Captured stdout
print(result.stderr)          # Captured stderr
print(result.execution_count) # Execution counter
print(result.error)           # Error output if failed
```

### Document-First Execution

The session uses a document-first model where cells are stored in an automerge document. This enables multi-client synchronization.

```python
# Create a cell in the document
cell_id = session.create_cell("x = 10")

# Update cell source
session.set_source(cell_id, "x = 20")

# Execute by cell ID (daemon reads source from document)
result = session.execute_cell(cell_id)

# Read cell state
cell = session.get_cell(cell_id)
print(cell.source)           # "x = 20"
print(cell.execution_count)  # 1

# List all cells
cells = session.get_cells()

# Delete a cell
session.delete_cell(cell_id)
```

### Context Manager

Sessions work as context managers for automatic cleanup:

```python
with runtimed.Session() as session:
    session.start_kernel()
    result = session.run("1 + 1")
# Kernel automatically shut down on exit
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `notebook_id` | `str` | Unique identifier for this notebook |
| `is_connected` | `bool` | Whether connected to daemon |
| `kernel_started` | `bool` | Whether kernel is running |
| `env_source` | `str \| None` | Environment source (e.g., "uv:prewarmed") |

## DaemonClient API

The `DaemonClient` class provides low-level access to daemon operations.

```python
client = runtimed.DaemonClient()

# Health checks
client.ping()         # True if daemon responding
client.is_running()   # True if daemon process exists

# Pool status
stats = client.status()
# {
#   'uv_available': 2,
#   'conda_available': 0,
#   'uv_warming': 1,
#   'conda_warming': 0
# }

# Active notebook rooms
rooms = client.list_rooms()
# [
#   {
#     'notebook_id': 'my-notebook',
#     'active_peers': 2,
#     'has_kernel': True,
#     'kernel_type': 'python',
#     'kernel_status': 'idle',
#     'env_source': 'uv:prewarmed'
#   }
# ]

# Operations
client.flush_pool()   # Clear and rebuild environment pool
client.shutdown()     # Stop the daemon
```

## Result Types

### ExecutionResult

Returned by `run()` and `execute_cell()`:

```python
result = session.run("print('hello')")

result.cell_id          # Cell that was executed
result.success          # True if no error
result.execution_count  # Execution counter value
result.outputs          # List of Output objects
result.stdout           # Combined stdout text
result.stderr           # Combined stderr text
result.display_data     # List of display_data/execute_result outputs
result.error            # First error output, or None
```

### Output

Individual outputs from execution:

```python
for output in result.outputs:
    print(output.output_type)  # "stream", "display_data", "execute_result", "error"

    # For streams
    print(output.name)  # "stdout" or "stderr"
    print(output.text)  # The text content

    # For display_data/execute_result
    print(output.data)  # Dict[str, str] of MIME type -> content

    # For errors
    print(output.ename)      # Exception class name
    print(output.evalue)     # Exception message
    print(output.traceback)  # List of traceback lines
```

### Cell

Cell from the automerge document:

```python
cell = session.get_cell(cell_id)

cell.id              # Cell identifier
cell.cell_type       # "code", "markdown", or "raw"
cell.source          # Cell source content
cell.execution_count # Execution count if executed
```

## Multi-Client Scenarios

Two sessions with the same `notebook_id` share the same kernel and document:

```python
# Session 1 creates a cell
s1 = runtimed.Session(notebook_id="shared")
s1.connect()
s1.start_kernel()
cell_id = s1.create_cell("x = 42")

# Session 2 sees the cell and shares the kernel
s2 = runtimed.Session(notebook_id="shared")
s2.connect()
s2.start_kernel()  # Reuses existing kernel

cells = s2.get_cells()
assert any(c.id == cell_id for c in cells)

# Execute in s2, result visible to s1
s2.run("print(x)")  # Uses x=42 from s1's execution
```

This enables:
- Multiple Python processes sharing a notebook
- Python scripts interacting with notebooks open in the app
- Agent workflows with parallel execution

## Error Handling

All errors raise `RuntimedError`:

```python
try:
    session.execute_cell("nonexistent-cell-id")
except runtimed.RuntimedError as e:
    print(f"Error: {e}")  # "Cell not found: nonexistent-cell-id"
```

Common error scenarios:
- Connection to daemon fails
- Kernel not started before execution
- Cell not found
- Execution timeout
- Kernel errors

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CONDUCTOR_WORKSPACE_PATH` | Use dev daemon for this worktree |
| `RUNTIMED_SOCKET_PATH` | Override daemon socket path |

## Sidecar (Rich Output Viewer)

The package also includes a sidecar launcher for rich output display:

```python
from runtimed import sidecar

# In a Jupyter kernel - auto-detects connection file
s = sidecar()

# In terminal IPython - creates IOPub bridge
s = sidecar()

# Explicit connection file
s = sidecar("/path/to/kernel-123.json")

# Check status
print(s.running)  # True if sidecar process is alive

# Cleanup
s.close()
```

The sidecar provides a GUI window that displays rich outputs (plots, HTML, images) from kernel execution.

# runtimed

Python bindings for the runtimed notebook daemon. Execute code, manage kernels, and interact with notebooks programmatically.

## Installation

```bash
pip install runtimed
```

## Quick Start

```python
import runtimed

with runtimed.Session() as session:
    session.start_kernel()
    result = session.run("print('hello')")
    print(result.stdout)  # "hello\n"
```

## Features

- **Code execution** via daemon-managed kernels
- **Document-first model** with automerge sync
- **Multi-client support** for shared notebooks
- **Rich output capture** (stdout, stderr, display_data, errors)

## Session API

```python
session = runtimed.Session(notebook_id="my-notebook")
session.start_kernel()

# Simple execution
result = session.run("x = 42")

# Document operations
cell_id = session.create_cell("print(x)")
result = session.execute_cell(cell_id)

# Inspect results
print(result.success)
print(result.stdout)
print(result.error)
```

## DaemonClient API

```python
client = runtimed.DaemonClient()
client.ping()        # Health check
client.status()      # Pool statistics
client.list_rooms()  # Active notebooks
```

## Requirements

- runtimed daemon running (`runt daemon start`)
- Python 3.9+

## Documentation

See [docs/python-bindings.md](https://github.com/nteract/desktop/blob/main/docs/python-bindings.md) for full documentation.

# Sidecar

A lightweight viewer of Jupyter output to run next to your terminal session.

## Installation

```bash
cargo install sidecar
```

## Usage

In a `jupyter console` session with Python, run:

```python
import subprocess
import os
from ipykernel.connect import get_connection_file

connection_file = get_connection_file()

subprocess.Popen(["sidecar", connection_file])
```

That will open a separate window showing the output of your Jupyter session.

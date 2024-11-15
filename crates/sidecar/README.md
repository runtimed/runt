# Sidecar

A lightweight viewer of Jupyter output to run next to your terminal session.

![sidecar view from jupyter console](https://github.com/user-attachments/assets/f34e89b9-950d-40fd-a65a-b89b84776e32)

## Installation

```bash
cargo install sidecar
```

## Usage

In a `jupyter console` session with Python, run:

```python
import subprocess
from ipykernel.connect import get_connection_file

connection_file = get_connection_file()

sidecar = subprocess.Popen(
    ["sidecar", "--quiet", connection_file],
    stdout=subprocess.PIPE, stderr=subprocess.PIPE
)
```

That will open a separate window showing the output of your Jupyter session.

It even works with anywidgets like `quak`!

```python
%load_ext quak
import polars as pl
df = pl.read_parquet(
    "https://github.com/uwdata/mosaic/raw/main/data/athletes.parquet"
)
df
```

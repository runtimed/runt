# @runt/pyodide-runtime-agent

Python runtime using Pyodide. This is a prototype implementation with IPython integration.

## Usage

```typescript
import { PyodideRuntimeAgent } from "@runt/pyodide-runtime-agent";
const agent = new PyodideRuntimeAgent(Deno.args); // presuming we got --notebook=NOTEBOOK_ID, etc.
await agent.start();
await agent.keepAlive();
```

**Features**:

- Python execution via Pyodide.
- Rich outputs (HTML, pandas tables, matplotlib SVG).
- IPython display system.
- Basic scientific computing stack pre-loaded.
- Code interruption.

**CLI Arguments**:

- `--notebook <id>` (required unless `NOTEBOOK_ID` set)
- `--auth-token <token>` (required unless `AUTH_TOKEN` set)

**Environment Variables**:

- `NOTEBOOK_ID`
- `AUTH_TOKEN`

## Important Considerations

- Package loading can be slow on first run.
- Not all Python packages are available in Pyodide.

## Pre-loaded Packages

- **Data**: `numpy`, `pandas`, `polars`, `pyarrow`, `duckdb`
- **Viz**: `matplotlib`, `bokeh`, `altair`
- **Science**: `scipy`, `sympy`, `scikit-learn`, `statsmodels`
- **Misc**: `requests`, `rich`, `beautifulsoup4`, `pillow`, `geopandas`, `networkx`

## Example

```python
import pandas as pd
import matplotlib.pyplot as plt

df = pd.DataFrame({'x': [1, 2, 3], 'y': [4, 5, 6]})
display(df)  # HTML table

plt.plot(df['x'], df['y'])
plt.show()  # SVG plot
```

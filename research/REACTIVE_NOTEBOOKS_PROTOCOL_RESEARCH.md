# Reactive Notebooks Protocol Research

**Date:** 2025-02-15
**Author:** Kyle Kelley
**Purpose:** Understand how ipyflow and marimo implement reactivity, and identify what Jupyter protocols need to achieve "internal consistency"

---

## Executive Summary

Both ipyflow and marimo solve the same problem—eliminating hidden state in notebooks—but take fundamentally different architectural approaches:

| Aspect | ipyflow | marimo |
|--------|---------|--------|
| **Architecture** | Layer on top of Jupyter | Ground-up replacement |
| **Analysis** | Runtime tracing + AST | Static AST only |
| **Protocol** | Uses Jupyter comms (workaround) | Custom WebSocket protocol |
| **Granularity** | Variable-level (including subscripts) | Cell-level |
| **Compatibility** | Works with existing notebooks | New format required |

**Key insight:** Neither has pushed changes into the Jupyter wire protocol itself. ipyflow works around it; marimo abandoned it.

---

## Part 1: ipyflow Architecture

### 1.1 Core Mechanism: Runtime Tracing via Pyccolo

ipyflow uses **Pyccolo**, a bytecode-level Python tracing framework, to intercept every variable access and assignment at runtime.

**File:** `core/ipyflow/tracing/ipyflow_tracer.py`

```python
class DataflowTracer(StackFrameManager):
    ast_rewriter_cls = DataflowAstRewriter
    should_patch_meta_path = True

    # Reactive annotation prefixes
    blocking_spec = pyc.AugmentationSpec(token="$:", replacement="")      # Block propagation
    cascading_reactive_spec = pyc.AugmentationSpec(token="$$", replacement="")  # Deep reactive
    reactive_spec = pyc.AugmentationSpec(token="$", replacement="")       # Shallow reactive
```

The tracer registers handlers for Python bytecode events:

```python
@pyc.register_raw_handler(pyc.after_load_complex_symbol)
def after_complex_symbol(self, obj: Any, node_id: NodeId, *_, **__) -> None:
    # Called every time a variable is loaded (read)
    loaded_sym = self._clear_info_and_maybe_lookup_or_create_complex_symbol(...)
    self.node_id_to_loaded_symbols.setdefault(self.top_level_node_id_for_chain, []).append(loaded_sym)
```

**Advantage:** Can track fine-grained dependencies like `x[0]` vs `x[1]`
**Disadvantage:** Runtime overhead, complexity

### 1.2 Dependency Graph: Symbol Model

**File:** `core/ipyflow/data_model/symbol.py`

Each variable becomes a `Symbol` with parent/child relationships:

```python
class Symbol:
    def __init__(self, ...):
        self.parents: Dict["Symbol", List[Timestamp]] = {}      # What I depend on
        self.children: Dict["Symbol", List[Timestamp]] = {}     # What depends on me
        self.required_timestamp: Timestamp = self.timestamp     # When I need refresh
        self.fresher_ancestors: Set["Symbol"] = set()           # Ancestors that changed
        self.cells_where_deep_live: Set[Cell] = set()           # Cells using me deeply
        self.cells_where_shallow_live: Set[Cell] = set()        # Cells using me shallowly
```

### 1.3 Update Propagation Protocol

**File:** `core/ipyflow/data_model/utils/update_protocol.py`

When a symbol updates, propagation walks the dependency graph:

```python
def _propagate_waiting_to_deps(self, sym: "Symbol", skip_seen_check: bool = False) -> None:
    if sym not in flow().updated_symbols and sym not in tracer().this_stmt_updated_symbols:
        if sym.should_mark_waiting(self.updated_sym):
            sym.fresher_ancestors.add(self.updated_sym)
            sym.fresher_ancestor_timestamps.add(self.updated_sym.timestamp)
            sym.required_timestamp = Timestamp.current()
    for child in self._non_class_to_instance_children(sym):
        self._propagate_waiting_to_deps(child)
```

### 1.4 Kernel Integration

**File:** `core/ipyflow/kernel/kernel.py`

ipyflow is a **drop-in replacement** for ipykernel:

```python
class IPyflowKernel(singletons.IPyflowKernel, IPythonKernel):
    implementation = "kernel"
    shell_class = Type(IPyflowZMQInteractiveShell)

    def before_init_metadata(self, parent) -> None:
        metadata = parent.get("metadata", {})
        cell_id = metadata.get("cellId", None)
        if cell_id is not None:
            flow_.set_active_cell(cell_id)
```

### 1.5 Frontend Communication: Jupyter Comms (The Workaround)

**File:** `core/ipyflow/comm_manager.py`

Since Jupyter's wire protocol doesn't support reactivity, ipyflow uses the **comm** mechanism (originally designed for widgets) to tunnel custom messages:

```python
class CommManager:
    def _register_default_handlers(self) -> None:
        self.register_comm_handler("change_active_cell", self.handle_change_active_cell)
        self.register_comm_handler("compute_exec_schedule", self.handle_compute_exec_schedule)
        self.register_comm_handler("notify_content_changed", self.handle_notify_content_changed)
        self.register_comm_handler("reactivity_cleanup", self.handle_reactivity_cleanup)
        self.register_comm_handler("refresh_symbols", self.handle_refresh_symbols)
```

**Key Messages:**

| Message Type | Direction | Purpose |
|-------------|-----------|---------|
| `compute_exec_schedule` | frontend→kernel | Request which cells to run |
| `notify_content_changed` | frontend→kernel | Cell content was edited |
| `reactivity_cleanup` | frontend→kernel | Clear reactive state |
| `refresh_symbols` | frontend→kernel | Re-analyze specific symbols |

The `compute_exec_schedule` response includes:

```python
response = {
    "type": "compute_exec_schedule",
    "exec_mode": self.flow.mut_settings.exec_mode.value,
    "exec_schedule": exec_schedule.value,
    "last_executed_cell_id": last_cell_id,
    "is_reactively_executing": is_reactively_executing,
    "executed_cells": list(cells().all_executed_cell_ids()),
}
```

**This is a workaround, not a protocol.** The comm mechanism wasn't designed for this; it's a side-channel.

---

## Part 2: marimo Architecture

### 2.1 Core Mechanism: Static AST Analysis

marimo analyzes code **before execution** using pure AST traversal.

**File:** `marimo/_ast/visitor.py`

```python
class ScopedVisitor(ast.NodeVisitor):
    def __init__(self, mangle_prefix=None, ignore_local=False, ...):
        self.block_stack: list[Block] = [Block()]   # Scope tracking
        self.ref_stack: list[set[Name]] = [set()]   # Reference context
        self._refs: dict[Name, list[RefData]] = {}  # All references

    @property
    def defs(self) -> set[Name]:
        """Variables defined at top-level scope"""
        return self.block_stack[0].defs

    @property
    def refs(self) -> set[Name]:
        """Variables referenced but not defined locally"""
        return set(self._refs.keys())
```

**Advantage:** No runtime overhead, deterministic
**Disadvantage:** Can't track dynamic dependencies like `getattr(obj, name)`

### 2.2 Dependency Graph: DirectedGraph

**File:** `marimo/_runtime/dataflow/graph.py`

The graph has three components:

```python
@dataclass(frozen=True)
class DirectedGraph(GraphTopology):
    topology: MutableGraphTopology          # Pure graph structure
    definition_registry: DefinitionRegistry # Variable → Cell mappings
    cycle_tracker: CycleTracker             # Circular dependency detection
    lock: threading.Lock                    # Thread safety
```

**File:** `marimo/_runtime/dataflow/topology.py`

```python
class MutableGraphTopology:
    _cells: dict[CellId_t, CellImpl]           # All cells
    _children: dict[CellId_t, set[CellId_t]]   # Cell → Dependents
    _parents: dict[CellId_t, set[CellId_t]]    # Cell → Dependencies
```

### 2.3 Edge Computation

**File:** `marimo/_runtime/dataflow/edges.py`

When a cell is registered, edges are computed by matching defs to refs:

```python
def compute_edges_for_cell(
    cell_id: CellId_t,
    cell: CellImpl,
    topology: GraphTopology,
    definitions: DefinitionRegistry,
) -> tuple[set[CellId_t], set[CellId_t]]:
    parents: set[CellId_t] = set()
    children: set[CellId_t] = set()

    # For each variable this cell defines, find cells that reference it
    for name, variable_data in cell.variable_data.items():
        referring_cells = get_referring_cells(name, variable.language, topology)
        children.update(referring_cells - {cell_id})

    # For each variable this cell references, find cells that define it
    for name in cell.refs:
        other_ids_defining_name = definitions.definitions.get(name, set())
        parents.update(other_ids_defining_name)

    return parents, children
```

### 2.4 Execution Model: Topological Sort

**File:** `marimo/_runtime/dataflow/__init__.py`

Cells execute in dependency order:

```python
def topological_sort(graph: GraphTopology, cell_ids: Collection[CellId_t]) -> list[CellId_t]:
    """Sort cells by dependencies using a heap queue."""
    in_degree = {cid: len(parents[cid]) for cid in cell_ids}

    # Start with cells that have no dependencies
    heap = [(order[cid], cid) for cid in cell_ids if in_degree[cid] == 0]
    heapify(heap)

    sorted_cells = []
    while heap:
        _, cid = heappop(heap)
        sorted_cells.append(cid)

        # Decrease in-degree of children
        for child in children[cid]:
            in_degree[child] -= 1
            if in_degree[child] == 0:
                heappush(heap, (order[child], child))

    return sorted_cells
```

### 2.5 Stale Cell Tracking

**File:** `marimo/_runtime/dataflow/graph.py`

```python
def set_stale(self, cell_ids: set[CellId_t], prune_imports: bool = False) -> None:
    """Mark cells and all their descendants as stale."""
    for cid in transitive_closure(self, cell_ids, relatives=relatives):
        self.topology.cells[cid].set_stale(stale=True)
```

### 2.6 Execution Modes

marimo supports two modes:

**Lazy Mode:**
```python
if self.reactive_execution_mode == "lazy":
    self.graph.set_stale(stale_cells, prune_imports=True)
    return cells_registered_without_error  # Don't auto-run
```

**Autorun Mode:**
```python
else:  # autorun
    return cells_registered_without_error.union(stale_cells)  # Run everything
```

### 2.7 Runtime Architecture

**File:** `marimo/_runtime/runtime.py`

marimo has its own kernel, not based on ipykernel:

```python
class Kernel:
    def __init__(self, cell_configs, ...):
        self.graph: DirectedGraph = DirectedGraph()
        self.globals: dict[str, Any] = {}  # Shared namespace
        self.reactive_execution_mode: OnCellChangeType = "autorun"
```

### 2.8 Message Protocol

marimo uses a custom WebSocket protocol with typed messages:

**File:** `marimo/_server/models/models.py`

```python
class ExecuteCellsRequest(msgspec.Struct, rename="camel"):
    cell_ids: list[CellId_t]
    codes: list[str]
    request: Optional[HTTPRequest] = None

class SaveNotebookRequest(msgspec.Struct, rename="camel"):
    cell_ids: list[CellId_t]
    codes: list[str]
    names: list[str]
    configs: list[CellConfig]
    filename: str
```

---

## Part 3: Comparison Matrix

| Feature | ipyflow | marimo | Jupyter (baseline) |
|---------|---------|--------|-------------------|
| **Dependency Detection** | Runtime + AST | Static AST only | None |
| **Granularity** | Variable + subscript | Cell level | None |
| **Hidden State** | Eliminated | Eliminated | Present |
| **Protocol** | Comm workaround | Custom WebSocket | execute_request only |
| **Backward Compatible** | Yes (.ipynb) | No (new format) | N/A |
| **Cross-frontend** | JupyterLab only | Own frontend | All frontends |
| **Variable Redefinition** | Allowed | Forbidden | Allowed |
| **Cycle Detection** | Runtime | Static | None |

---

## Part 4: What Jupyter Protocol Needs

### 4.1 Current Protocol Gap

The Jupyter wire protocol has **no concept of cell dependencies**. The only execution-related messages are:

```
execute_request  →  { code, silent, store_history, user_expressions }
execute_reply    ←  { status, execution_count }
execute_result   ←  { data, metadata, transient }
```

There's no way to express:
- "Cell A defines variable x"
- "Cell B references variable x"
- "Cell B depends on Cell A"
- "Cell B is stale because Cell A changed"

### 4.2 Proposed Protocol Extensions

#### New Message Types

**1. Cell Analysis (kernel→frontend)**
```python
cell_analysis = {
    "msg_type": "cell_analysis",
    "content": {
        "cell_id": "abc123",
        "defines": ["x", "y", "MyClass"],
        "references": ["pandas", "numpy", "z"],
        "imports": ["pandas", "numpy"],
        "errors": []  # Syntax errors, undefined refs, etc.
    }
}
```

**2. Dependency Graph Update (kernel→frontend)**
```python
dependency_update = {
    "msg_type": "dependency_update",
    "content": {
        "edges_added": [
            {"from": "cell_a", "to": "cell_b", "via": ["x", "y"]},
        ],
        "edges_removed": [...],
        "cycles_detected": [
            {"cells": ["cell_a", "cell_b", "cell_c"], "variables": ["x"]}
        ]
    }
}
```

**3. Stale Notification (kernel→frontend)**
```python
stale_cells = {
    "msg_type": "stale_cells",
    "content": {
        "stale": ["cell_b", "cell_c"],
        "reason": "dependency_changed",
        "trigger_cell": "cell_a"
    }
}
```

**4. Reactive Execute Request (frontend→kernel)**
```python
reactive_execute_request = {
    "msg_type": "reactive_execute_request",
    "content": {
        "cell_id": "cell_a",
        "code": "x = 42",
        "cascade": true,        # Run dependent cells
        "cascade_mode": "lazy"  # or "eager"
    }
}
```

**5. Cell Registration (frontend→kernel)**
```python
register_cell = {
    "msg_type": "register_cell",
    "content": {
        "cell_id": "abc123",
        "code": "x = 1 + y",
        "position": 3  # Notebook order
    }
}
```

#### Kernel Capability Negotiation

In `kernel_info_reply`, add:

```python
{
    "capabilities": {
        "reactive_execution": true,
        "dependency_tracking": true,
        "static_analysis": true,
        "stale_notification": true
    }
}
```

### 4.3 Backward Compatibility Strategy

1. **Feature Negotiation**: Kernels advertise capabilities in `kernel_info_reply`
2. **Graceful Degradation**: Old frontends ignore new message types
3. **Opt-in Behavior**: Reactive execution requires explicit `cascade: true`
4. **Parallel Paths**: `execute_request` continues to work as-is

### 4.4 Implementation Phases

**Phase 1: Cell Analysis Protocol**
- Add `register_cell` message
- Add `cell_analysis` response
- Kernel performs static analysis (AST-based like marimo)
- Frontend can display dependency info

**Phase 2: Dependency Graph Protocol**
- Add `dependency_update` message
- Kernel maintains and broadcasts graph changes
- Frontend can visualize dependencies

**Phase 3: Stale Notification**
- Add `stale_cells` message
- Kernel notifies frontend when cells become stale
- Frontend can highlight stale cells

**Phase 4: Reactive Execution**
- Add `reactive_execute_request` message
- Kernel can cascade execution to dependents
- Full Pluto/marimo-style reactivity

---

## Part 5: Key Insights

### 5.1 Why ipyflow Used Comms

Jupyter's comm mechanism was designed for widgets (ipywidgets), but it's the **only extensible side-channel** in the protocol. ipyflow had no choice but to tunnel through it because:

1. `execute_request` can't carry dependency metadata
2. `execute_reply` can't specify which cells should run next
3. There's no message type for "cell content changed but wasn't executed"

### 5.2 Why marimo Abandoned Jupyter

marimo's founders concluded that retrofitting reactivity onto Jupyter would require:
1. Changing the kernel protocol (JEP process)
2. Changing every frontend (JupyterLab, Notebook, VS Code, Colab)
3. Maintaining backward compatibility with non-reactive notebooks
4. Convincing the Jupyter community to accept the complexity

Building fresh was faster and cleaner.

### 5.3 The Single-Definition Constraint

Both Pluto and marimo enforce **one cell per variable definition**. This is a trade-off:

**Pro:** Eliminates ambiguity about which cell "owns" a variable
**Con:** Breaks common patterns like incremental data manipulation

```python
# Common in Jupyter, forbidden in Pluto/marimo
# Cell 1
df = load_data()

# Cell 2
df = df.dropna()  # ERROR: df already defined in Cell 1

# Cell 3
df = df.filter(...)  # ERROR: df already defined in Cell 1
```

ipyflow allows this but tracks it at the **timestamp** level—a more complex solution.

### 5.4 Runtime vs Static Analysis Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| **Static (marimo)** | Fast, deterministic, no overhead | Misses dynamic patterns |
| **Runtime (ipyflow)** | Catches everything | Overhead, complexity, non-deterministic |
| **Hybrid** | Best of both | Implementation complexity |

A JEP-based solution could start with static analysis (simpler) and add runtime hooks later.

---

## Part 6: Recommendations

### 6.1 Short Term: Learn from ipyflow's Comm Protocol

ipyflow's comm messages are essentially a **draft protocol**. The messages could be standardized:

- `compute_exec_schedule` → `dependency_query`
- `notify_content_changed` → `cell_updated`
- `reactivity_cleanup` → `clear_stale_state`

### 6.2 Medium Term: JEP for Cell Analysis

Start with a JEP that adds `cell_analysis` messages. This is:
- Non-breaking (new message type)
- Useful standalone (dependency visualization)
- Foundation for later reactivity

### 6.3 Long Term: Full Reactive Protocol

Build on cell analysis to add:
- Stale notifications
- Reactive execution cascading
- Configurable execution modes (lazy/eager)

### 6.4 Governance Consideration

A reactive execution model changes Jupyter's core semantics. This needs:
- Buy-in from JupyterLab, Notebook, and ipykernel teams
- Clear backward compatibility guarantees
- Extensive testing with existing notebooks

---

## Appendix: Key Files Reference

### ipyflow
| Path | Purpose |
|------|---------|
| `core/ipyflow/tracing/ipyflow_tracer.py` | Runtime tracing via Pyccolo |
| `core/ipyflow/tracing/flow_ast_rewriter.py` | AST instrumentation |
| `core/ipyflow/data_model/symbol.py` | Symbol dependency model |
| `core/ipyflow/data_model/cell.py` | Cell model |
| `core/ipyflow/data_model/utils/update_protocol.py` | Dependency propagation |
| `core/ipyflow/comm_manager.py` | Frontend communication |
| `core/ipyflow/kernel/kernel.py` | Kernel integration |
| `core/ipyflow/config.py` | Execution modes config |

### marimo
| Path | Purpose |
|------|---------|
| `marimo/_ast/visitor.py` | Static AST analysis |
| `marimo/_ast/cell.py` | Cell model |
| `marimo/_runtime/dataflow/graph.py` | Dependency graph |
| `marimo/_runtime/dataflow/topology.py` | Graph structure |
| `marimo/_runtime/dataflow/edges.py` | Edge computation |
| `marimo/_runtime/dataflow/cycles.py` | Cycle detection |
| `marimo/_runtime/runtime.py` | Kernel implementation |
| `marimo/_server/models/models.py` | Message types |

---

## Conclusion

The path to "internal consistency" in Jupyter requires protocol-level changes. Both ipyflow and marimo have proven the concept works; now the question is whether to:

1. **Standardize ipyflow's comm-based approach** (faster, less coordination)
2. **Create a proper JEP** (slower, broader adoption)
3. **Wait for marimo/Pluto to win** (let the market decide)

Option 2 is the most impactful for the Jupyter ecosystem long-term, but requires significant community coordination.

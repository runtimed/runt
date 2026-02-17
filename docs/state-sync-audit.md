# State Synchronization Architecture Audit

## Context

This audit evaluates the current state management architecture in Runt Notebook to identify areas where the frontend is overly reliant on local state instead of syncing with the backend. The goal is to assess migration options toward an event-sourced architecture and evaluate CRDT libraries that could enable:

1. **Better state consistency** - Reduce bugs from frontend/backend desync
2. **Real-time collaboration** - Support humans AND agents editing documents simultaneously
3. **Event sourcing** - Audit trail, undo/redo, debugging capabilities

**Key requirements from user:**
- Evaluate compatibility with [jupyter-server-documents](https://github.com/jupyter-ai-contrib/jupyter-server-documents)
- Support MCP daemon for agent access to realtime documents
- Address execution queue inconsistencies

---

## Current Architecture Summary

### State Management Pattern

**Frontend (React hooks)** - No global store, state scattered across hooks:
- `useNotebook.ts` - cells, dirty flag, focused cell
- `useKernel.ts` - kernel status, connection management
- `useExecutionQueue.ts` - execution queue state
- `widget-store.ts` - widget models (Map-based)
- `useDependencies.ts` / `useCondaDependencies.ts` - package state
- `useTrust.ts` - notebook trust verification

**Backend (Rust/Tauri)** - Authoritative state held in Mutexes:
- `NotebookState` (cells, metadata, dirty flag)
- `NotebookKernel` (status, cell_id_map, completions)
- `ExecutionQueue` (pending/executing cells)

**Communication**: Command-based RPC (`invoke()`) + one-way event notifications (`emit()`)

---

## Key Issues Identified

### 1. Optimistic Updates Without Reconciliation

**Location**: `apps/notebook/src/hooks/useNotebook.ts:20-26`

```typescript
const updateCellSource = useCallback((cellId: string, source: string) => {
  setCells((prev) =>
    prev.map((c) => (c.id === cellId ? { ...c, source } : c))
  );
  setDirty(true);
  invoke("update_cell_source", { cellId, source }).catch(console.error);
}, []);
```

Frontend updates immediately, backend call is fire-and-forget. If backend fails, frontend state diverges with no recovery mechanism.

### 2. Multiple Sources of Truth for Widget State

**Locations**:
- `src/components/widgets/widget-store.ts` - parent window store
- `src/components/outputs/isolated/comm-bridge-manager.ts` - iframe bridge
- Kernel's widget model state

CommBridgeManager uses manual shallow diffing (`getChangedKeys`) to detect changes, which misses nested property changes. The `isProcessingIframeUpdate` flag has race condition potential.

### 3. Fire-and-Forget Event Pattern

All Tauri events (`kernel:iopub`, `queue:state`, `env:progress`) are one-way notifications with no acknowledgment. If events are lost, frontend won't know.

### 4. Backend Lock Contention

`execution_queue.rs` processor holds Queue → Notebook → Kernel locks sequentially, risking priority inversion with long kernel operations.

### 5. Cell ID Map Race Condition

`kernel.rs` maintains `CellIdMap` (msg_id → cell_id). The map is populated before execution but queried on iopub receipt - timing gaps could cause misroutes.

### 6. Silent Failures Throughout

Most backend invocations use `.catch(console.error)` with no user feedback or retry logic. Theme sync, dependency operations, and cell updates all fail silently.

---

## State Domains by Migration Priority

| Domain | Current Issues | CRDT Benefit | Priority |
|--------|---------------|--------------|----------|
| **NotebookState** | Optimistic updates, no reconciliation | High - Y.Array for cells, Y.Text for source | **P0** |
| **WidgetStore** | Multiple sources of truth, manual diffing | High - Y.Map replaces manual sync | **P0** |
| **ExecutionQueue** | Lock contention, ordering | Medium - Event sourcing helps | P1 |
| **KernelState** | Status can lag | Low - Derived state, not collaborative | P2 |
| **Dependencies** | Simple set operations | Low | P3 |

---

## Technology Evaluation

### jupyter-server-documents Protocol Analysis

**Protocol Details** (from source analysis):
- Uses **Y.js CRDT** via `pycrdt.Doc` (Python)
- **WebSocket binary protocol** with 2-byte headers:
  - Byte 0: Message type (SYNC=0, AWARENESS=1)
  - Byte 1: Subtype (SYNC_STEP1=0, SYNC_STEP2=1, SYNC_UPDATE=2)
- **Room-based** document management (`{format}:{type}:{id}`)
- **Awareness protocol** for presence/cursor tracking
- Three-way handshake for initial sync, then incremental updates

**Key finding**: This is the **standard y-sync protocol** - not proprietary.

**Output/Buffer Handling** (important for widgets):
- Outputs stored **separately** from Y.Doc - URL placeholders in doc, actual data on disk
- Y.Doc contains: `_ystate` (Map), `_ycells` (Array), `ymeta` (Map)
- Large outputs retrieved on-demand via HTTP (`/api/outputs/{file_id}/{cell_id}/{output_index}`)
- This keeps Y.Doc lightweight - binary buffers are NOT in the CRDT

**Attribution**:
- User identity tracked via Y.js awareness protocol
- `awareness.setLocalStateField('user', user.identity)` on each client
- Changes associated with user through shared awareness state
- No separate event log needed for "who did what" - awareness handles it

### yrs (Rust Y.js) - RECOMMENDED

**Protocol Compatibility**:
> "maintain behavior and binary protocol compatibility with Yjs, therefore projects using Yjs/Yrs should be able to interoperate"

This means a Rust implementation can speak the **exact same protocol** as jupyter-server-documents.

**Strengths**:
- **Protocol compatible**: Same binary format as pycrdt/Y.js
- **Native Rust**: `yrs` crate integrates directly with Tauri backend
- **Mature ecosystem**: y-websocket, y-indexeddb (frontend), yrs-warp (Rust WebSocket)
- **Rich types**: Y.Array (cells), Y.Text (cell source), Y.Map (widget state, metadata)
- **JupyterLab alignment**: Potential interop with Jupyter ecosystem

**Weaknesses**:
- Learning curve for CRDT semantics
- No built-in event log (add separately)

**Fit**: Excellent - protocol compatibility enables both standalone and Jupyter ecosystem integration

### automerge

**Strengths**:
- Rust-first implementation
- Built-in history for undo/audit
- JSON-like API

**Weaknesses**:
- **Different protocol** - Not compatible with jupyter-server-documents
- Larger binary due to history
- Smaller ecosystem

**Fit**: Good for standalone, but loses Jupyter interop

### LiveStore

**Strengths**:
- Event sourcing first
- SQLite integration

**Weaknesses**:
- **Not a CRDT** - No automatic conflict resolution
- Cannot interoperate with Jupyter ecosystem

**Fit**: Only for internal state, not document sync

---

## Recommendation: yrs (Rust) with y-sync Protocol

### Rationale

1. **Protocol compatibility** - Same binary format as jupyter-server-documents
2. **Multi-client support** - Humans (UI), agents (MCP), and potentially JupyterLab
3. **Native Rust** - No FFI overhead, integrates with existing Tauri backend
4. **Proven scale** - Y.js protocol used by Notion, Linear (Note: Figma uses custom CRDTs, not Y.js)

### Target Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                    Runt Document Server (Rust)                      │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │                 Y.Doc (yrs) - Single Source of Truth        │    │
│  │  cells: Y.Array    metadata: Y.Map    widgets: Y.Map       │    │
│  │  ├─ source: Y.Text                    ├─ commId → state    │    │
│  │  ├─ outputs: Y.Array                                        │    │
│  └────────────────────────────────────────────────────────────┘    │
│                              │                                      │
│  ┌──────────────────────────┴──────────────────────────┐           │
│  │              y-sync Protocol (WebSocket)             │           │
│  │   SYNC_STEP1/2, SYNC_UPDATE, AWARENESS_UPDATE       │           │
│  └──────────────────────────────────────────────────────┘           │
└────────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Notebook UI    │  │  MCP Daemon     │  │  JupyterLab     │
│  (React + yjs)  │  │  (Agent access) │  │  (potential)    │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### Why This Enables Agent Access

With a y-sync protocol server:
- **MCP tools** can connect via WebSocket and make document edits
- **Agents** see real-time updates from human edits
- **Humans** see real-time updates from agent edits
- **Conflict resolution** is automatic (CRDT semantics)

### Widget Buffer Handling Strategy

Following jupyter-server-documents pattern:
- **Widget state** (JSON-serializable) → in Y.Doc as Y.Map
- **Binary buffers** (ArrayBuffer) → stored separately, referenced by URL/ID
- **Comm messages** → passthrough for custom messages, state updates sync via Y.Map

For anywidget specifically:
- Current state in Y.Map is shareable
- Custom messages (canvas commands, etc.) are ephemeral events, not CRDT'd
- This model works well: state is shared, events are transient

### Attribution (via Y.js Awareness)

Attribution ("who did what") is handled by the **awareness protocol** built into Y.js:

```typescript
// Each client identifies itself
awareness.setLocalStateField('user', {
  id: 'user-123',
  name: 'Kyle',
  color: '#ff0000'
});
```

- All clients see who else is connected
- Changes are associated with the user who made them
- Cursor positions and selections are shared
- **No separate event log needed for attribution**

### Event Log (Optional, Deprioritized)

A full event log can be added later if needed for:
- Debugging/replay
- Compliance requirements
- Undo beyond Y.js's built-in undo manager

For now, Y.js's built-in `UndoManager` + awareness provides sufficient attribution and undo capability.

---

## Migration Strategy

### Assessment: This is a Significant Architectural Change

This work should move to the **runtimed crates** repository for several reasons:

1. **Scope**: Document server with y-sync protocol is infrastructure, not notebook-specific
2. **Reusability**: Other runtimed tools could benefit from the same CRDT infrastructure
3. **Isolation**: Can develop and test without disrupting notebook development
4. **MCP integration**: Daemon architecture fits better in shared infrastructure

### Recommended Spike: Proof of Concept in runtimed

**Goal**: Validate y-sync protocol compatibility with minimal investment

**Spike scope** (1-2 weeks):
1. Create `runtimed-crdt` crate with `yrs` dependency
2. Implement basic Y.Doc with cells array and metadata map
3. Add WebSocket server with y-sync protocol (SYNC_STEP1/2, UPDATE)
4. Build minimal test client (can be Node.js with yjs for quick validation)
5. Verify binary protocol compatibility with pycrdt

**Open questions to validate in spike**:
- How does jupyter-server-documents handle widget comm messages exactly? (passthrough vs sync)
- What's the right boundary between Y.Doc state and transient events?

**Widget sync approaches to spike**:
1. **Full state sync** - Widget state lives in Y.Map, always consistent across clients
2. **Event-driven with snapshots** - Only sync current state on demand, events are transient

Need to evaluate both to find the right model for anywidget compatibility.

**Success criteria**:
- Y.js client can sync with yrs server
- Round-trip: edit in client → server update → broadcast to other clients
- Protocol messages match jupyter-server-documents format

### Post-Spike: Full Migration Path

If spike succeeds:

**Phase 1: Document Server** (in runtimed)
- Full Y.Doc schema for notebooks
- Persistence layer (file-backed, optional SQLite)
- Event log for audit trail
- MCP tool definitions for agent access

**Phase 2: Notebook Integration** (in belgrade)
- Replace `useNotebook` with Y.Doc subscription
- Connect to document server via WebSocket
- Migrate widget store to Y.Map

**Phase 3: Execution Queue Fix** (immediate priority)
- Move queue state into Y.Doc
- All clients see consistent queue state
- Eliminates race conditions and lock contention

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Migration complexity | Feature flags, gradual rollout |
| Performance regression | Benchmark suite before/after |
| Binary buffer handling | Keep separate from CRDT (ArrayBuffers don't fit CRDT model) |
| nbformat compatibility | Thorough converter tests |
| Team learning curve | Documentation, pairing |

---

## Verification Plan

1. **Unit tests**: Y.Doc ↔ nbformat conversion roundtrips
2. **Integration tests**: Frontend-backend sync under concurrent updates
3. **Manual testing**:
   - Open notebook, edit cells, verify backend receives updates
   - Widget interactions sync between iframe and parent
   - Kill/restart kernel, verify state consistency
4. **Performance**: Compare memory/CPU with large notebooks (100+ cells, widgets)

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `apps/notebook/src/hooks/useNotebook.ts` | Replace with CRDT-backed hook |
| `src/components/widgets/widget-store.ts` | Migrate to Y.Map |
| `src/components/outputs/isolated/comm-bridge-manager.ts` | Simplify with CRDT sync |
| `crates/notebook/src/notebook_state.rs` | Integrate yrs, sync with Y.Doc |
| `crates/notebook/src/kernel.rs` | Consider CRDT for cell_id_map |
| `package.json` | Add yjs, y-indexeddb |
| `crates/notebook/Cargo.toml` | Add yrs crate |

---

## Next Steps

1. **Decision**: Confirm yrs/y-sync as the approach (this audit recommends it)
2. **Spike in runtimed**: Create `runtimed-crdt` crate with y-sync protocol PoC
3. **Validate**: Test protocol compatibility with Y.js/pycrdt clients
4. **Design MCP tools**: Define agent interface to realtime documents
5. **Integrate**: Connect notebook UI to document server

---

## Appendix: jupyter-server-documents Protocol Reference

**WebSocket Message Format**:
```
┌──────────┬──────────┬─────────────────────┐
│ Byte 0   │ Byte 1   │ Payload             │
│ MsgType  │ SubType  │ (variable length)   │
└──────────┴──────────┴─────────────────────┘

MsgType:
  0 = SYNC
  1 = AWARENESS

SYNC SubType:
  0 = SYNC_STEP1 (client requests sync)
  1 = SYNC_STEP2 (server sends state)
  2 = SYNC_UPDATE (incremental update)
```

**Room ID Format**: `"{format}:{type}:{id}"`
- Example: `"json:notebook:abc123"`

**Sync Handshake**:
1. Client connects, sends SYNC_STEP1
2. Server responds with SYNC_STEP2 (full state)
3. Server sends SYNC_STEP1 to get client's state
4. Ongoing: SYNC_UPDATE messages for incremental changes

**Awareness**: Tracks user presence, cursor position, execution state

# @runt/schema

LiveStore schema for Anode notebooks, defining events, tables, and types with
conflict-free cell ordering and real-time collaboration support.

## Usage

```typescript
import { createCellBetween, events, schema, tables } from "jsr:@runt/schema";

// Create cells using the helper (recommended approach)
const createEvent = createCellBetween(
  {
    id: "cell-123",
    cellType: "code",
    createdBy: "my-runtime",
  },
  cellBefore, // CellReference | null
  cellAfter, // CellReference | null
);
store.commit(createEvent);

// Query tables
const cells = store.query(tables.cells.select().where({ cellType: "code" }));
const outputs = store.query(
  tables.outputs.select().where({ cellId: "cell-123" }),
);
```

## Core Functions

### `createCellBetween`

Primary helper for creating cells with proper fractional indexing. Internally
uses `events.cellCreated2`.

```typescript
createCellBetween(
  cellData: {
    id: string;
    cellType: CellType;
    createdBy: string;
  },
  cellBefore: CellReference | null,
  cellAfter: CellReference | null,
  jitterProvider?: JitterProvider
): ReturnType<typeof events.cellCreated2>
```

**Examples:**

```typescript
// Insert at beginning
const event = createCellBetween(cellData, null, firstCell);

// Insert at end
const event = createCellBetween(cellData, lastCell, null);

// Insert between cells
const event = createCellBetween(cellData, cell1, cell2);

// Custom jitter for testing
const event = createCellBetween(cellData, null, null, mockJitterProvider);
```

### `moveCellBetween`

Helper for repositioning existing cells with conflict-free ordering.

```typescript
moveCellBetween(
  cellId: string,
  cellBefore: CellReference | null,
  cellAfter: CellReference | null,
  jitterProvider?: JitterProvider
): ReturnType<typeof events.cellMoved2>
```

## Schema Structure

### Events

**Cell Lifecycle:**

- `cellCreated2` - Created via `createCellBetween` with fractional indexing
- `cellUpdated` - Content or metadata changes
- `cellDeleted` - Cell removal
- `cellMoved2` - Position changes via `moveCellBetween`

**Execution:**

- `executionRequested` - Queued for execution
- `executionStarted` - Runtime begins processing
- `executionCompleted` - Finished with success/error state

**Outputs:**

- `cellOutputAdded` - Rich display data, stdout, stderr
- `cellOutputsCleared` - Remove all outputs for cell

**Runtime Management:**

- `runtimeSessionStarted` - New runtime connection
- `runtimeSessionHeartbeat` - Keep-alive signal
- `runtimeSessionTerminated` - Runtime disconnect

### Tables

**`cells`** - Cell content and state

- `id`, `cellType`, `source`, `fractionalIndex`
- `createdAt`, `updatedAt`, `createdBy`
- `executionCount`, `lastExecutedAt`

**`outputs`** - Rich execution results

- `cellId`, `outputType`, `data` (MediaBundle)
- `executionCount`, `createdAt`

**`executionQueue`** - Pending executions

- `cellId`, `status`, `requestedAt`
- `startedAt`, `sessionId`

**`runtimeSessions`** - Active runtimes

- `sessionId`, `runtimeType`, `startedAt`
- `lastHeartbeatAt`, `capabilities`

**`notebook`** - Metadata

- `id`, `title`, `createdAt`, `updatedAt`

## Key Types

```typescript
type CellType = "code" | "markdown" | "ai";

interface CellData {
  id: string;
  cellType: CellType;
  source: string;
  fractionalIndex: string;
  createdBy: string;
  executionCount: number;
}

interface CellReference {
  id: string;
  fractionalIndex: string;
}

interface MediaBundle {
  [mimeType: string]: string;
  // e.g., "text/plain", "text/html", "image/png"
}
```

## Fractional Indexing

Cell ordering uses fractional indices to avoid conflicts during concurrent
edits:

```typescript
// Indices are lexicographically ordered strings
"a" < "b" < "c" < "z";
"a0" < "a1" < "a2";
"aV" < "aW" < "aX";

// Always room to insert between any two indices
fractionalIndexBetween("a", "b"); // → "aV" (example)
fractionalIndexBetween("aV", "aW"); // → "aVV"
```

## Important Constraints

**Materializer Purity**: All materializers must be deterministic functions. No
`Date()`, `Math.random()`, or external state access. Use event data only.

**Event Immutability**: Once committed, events cannot be modified. Design schema
changes carefully.

**Cell Creation**: Always use `createCellBetween` instead of direct
`events.cellCreated2` to ensure proper indexing.

**Session Overlap**: Runtime restarts create new `sessionId` values. Handle
overlapping sessions during transitions.

**Concurrent Safety**: Fractional indices prevent ordering conflicts when
multiple clients create cells simultaneously.

## Development Notes

**Dual Package Files**:

- `package.json` - Local development syncing with Anode
- `deno.json` - JSR publishing and Deno runtime

**Type Safety**: All events and tables are fully typed. LiveStore enforces
schema at runtime.

**Testing**: Use `createTestJitterProvider()` for deterministic fractional
indices in tests.

## Migration from Legacy Events

**Before (deprecated):**

```typescript
store.commit(events.cellCreated({ cellId, cellType, source, position }));
```

**After (current):**

```typescript
const event = createCellBetween(
  { id: cellId, cellType, createdBy: "runtime" },
  cellBefore,
  cellAfter,
);
store.commit(event);
```

The helper handles fractional indexing automatically and uses the current
`cellCreated2` event internally.

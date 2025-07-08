# @runt/schema

LiveStore schema for Anode notebooks, defining events, tables, and types.

```typescript
import { events, schema, tables } from "jsr:@runt/schema";

// Events
store.commit(events.cellCreated({ cellId, cellType, source, position }));

// Tables
const cells = store.query(tables.cells.select().where({ cellType: "code" }));
```

**Events**:

- `cellCreated`, `cellUpdated`, `cellDeleted`, `cellMoved`
- `executionRequested`, `executionStarted`, `executionCompleted`
- `cellOutputAdded`, `cellOutputsCleared`
- `runtimeSessionStarted`, `runtimeSessionHeartbeat`, `runtimeSessionTerminated`

**Tables**:

- `notebook` - metadata
- `cells` - content and execution state
- `outputs` - stdout, plots, errors
- `executionQueue` - pending/running executions
- `runtimeSessions` - active connections

**Key Types**:

- `CellData`, `OutputData`, `RuntimeSessionData`, `ExecutionQueueData`

## Important Considerations

- Materializers must be pure functions.
- Events are immutable once added.
- Schema changes must be backward compatible.

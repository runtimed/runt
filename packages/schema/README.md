# @runt/schema

LiveStore schema for anode notebooks. Events, tables, and types.

```typescript
import { events, schema, tables } from "jsr:@runt/schema";

// Events
store.commit(events.cellCreated({ cellId, cellType, source, position }));

// Tables
const cells = store.query(tables.cells.select().where({ cellType: "code" }));
```

Events:

- `cellCreated`, `cellUpdated`, `cellDeleted`, `cellMoved`
- `executionRequested`, `executionStarted`, `executionCompleted`
- `cellOutputAdded`, `cellOutputsCleared`
- `runtimeSessionStarted`, `runtimeSessionHeartbeat`, `runtimeSessionTerminated`

Tables:

- `notebook` - metadata
- `cells` - content and execution state
- `outputs` - stdout, plots, errors
- `executionQueue` - pending/running executions
- `runtimeSessions` - active connections

Key types: `CellData`, `OutputData`, `RuntimeSessionData`, `ExecutionQueueData`

## Notes

- Materializers must be pure functions
- Events are immutable once added
- Schema changes must be backward compatible

# Unified Output System Refactor - Runtime Agent Handoff

**Branch**: `feature/unified-output-system`  
**Status**: Ready for implementation  
**Timeline**: 1-2 weeks  
**Breaking Changes**: Yes (schema and ExecutionContext)

## Overview

This refactor replaces the single `cellOutputAdded` event with granular, type-safe events in the schema package, and updates ExecutionContext methods in the runtime agent to emit these new events.

## Core Changes

### Schema Package (`packages/schema/mod.ts`)

#### New Events to Add
```typescript
// Multi-media outputs (replaces display_data/execute_result)
multimediaDisplayOutputAdded: Events.synced({
  name: "v1.MultimediaDisplayOutputAdded",
  schema: Schema.Struct({
    id: Schema.String,
    cellId: Schema.String,
    position: Schema.Number,
    representations: Schema.Record(Schema.String, MediaRepresentationSchema),
    displayId: Schema.optional(Schema.String),
  }),
}),

multimediaResultOutputAdded: Events.synced({
  name: "v1.MultimediaResultOutputAdded", 
  schema: Schema.Struct({
    id: Schema.String,
    cellId: Schema.String,
    position: Schema.Number,
    representations: Schema.Record(Schema.String, MediaRepresentationSchema),
    executionCount: Schema.Number,
  }),
}),

// Terminal outputs (replaces stream)
terminalOutputAdded: Events.synced({
  name: "v1.TerminalOutputAdded",
  schema: Schema.Struct({
    id: Schema.String,
    cellId: Schema.String,
    position: Schema.Number,
    content: MediaRepresentationSchema,
    streamName: Schema.Literal("stdout", "stderr"),
  }),
}),

terminalOutputAppended: Events.synced({
  name: "v1.TerminalOutputAppended",
  schema: Schema.Struct({
    outputId: Schema.String,
    content: MediaRepresentationSchema,
  }),
}),

// Markdown outputs (new for AI responses)
markdownOutputAdded: Events.synced({
  name: "v1.MarkdownOutputAdded",
  schema: Schema.Struct({
    id: Schema.String,
    cellId: Schema.String,
    position: Schema.Number,
    content: MediaRepresentationSchema,
  }),
}),

markdownOutputAppended: Events.synced({
  name: "v1.MarkdownOutputAppended",
  schema: Schema.Struct({
    outputId: Schema.String,
    content: MediaRepresentationSchema,
  }),
}),

// Error outputs
errorOutputAdded: Events.synced({
  name: "v1.ErrorOutputAdded",
  schema: Schema.Struct({
    id: Schema.String,
    cellId: Schema.String,
    position: Schema.Number,
    content: MediaRepresentationSchema,
  }),
}),
```

#### MediaRepresentation Schema
```typescript
const MediaRepresentationSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("inline"),
    data: Schema.Any,
    metadata: Schema.optional(Schema.Any),
  }),
  Schema.Struct({
    type: Schema.Literal("artifact"),
    artifactId: Schema.String,
    metadata: Schema.optional(Schema.Any),
  })
);
```

#### Enhanced Clear Support
```typescript
// Add to pendingClears table
const pendingClears = State.SQLite.table({
  name: 'pendingClears',
  columns: {
    cellId: State.SQLite.text({ primaryKey: true }),
    clearedBy: State.SQLite.text(),
  }
});

// Update cellOutputsCleared event
cellOutputsCleared: Events.synced({
  name: "v1.CellOutputsCleared",
  schema: Schema.Struct({
    cellId: Schema.String,
    wait: Schema.Boolean,  // NEW: support for clear_output(wait=True)
    clearedBy: Schema.String,
  }),
}),
```

#### Updated Materializers
All `*OutputAdded` events need pending clear logic:
```typescript
const handlePendingClear = (cellId: string, ctx: any) => {
  const ops = [];
  const pendingClear = ctx.query(tables.pendingClears.where({ cellId }).first());
  if (pendingClear) {
    ops.push(tables.outputs.delete().where({ cellId }));
    ops.push(tables.pendingClears.delete().where({ cellId }));
  }
  return ops;
};

// Apply to all *OutputAdded materializers
"v1.MultimediaDisplayOutputAdded": ({ cellId, ...rest }, ctx) => {
  const ops = handlePendingClear(cellId, ctx);
  ops.push(/* insert new output */);
  return ops;
},
```

### Runtime Agent (`packages/lib/src/runtime-agent.ts`)

#### Updated ExecutionContext Methods
```typescript
// Current implementation in processExecution()
const context: ExecutionContext = {
  // Terminal output (stdout/stderr)
  stdout: (text: string) => {
    this.store.commit(events.terminalOutputAdded({
      id: crypto.randomUUID(),
      cellId: cell.id,
      streamName: "stdout",
      content: { type: "inline", data: text },
      position: outputPosition++,
    }));
  },

  stderr: (text: string) => {
    this.store.commit(events.terminalOutputAdded({
      id: crypto.randomUUID(),
      cellId: cell.id,
      streamName: "stderr", 
      content: { type: "inline", data: text },
      position: outputPosition++,
    }));
  },

  // Multi-media display
  display: (data: MediaBundle, metadata?: Record<string, unknown>, displayId?: string) => {
    const representations = Object.fromEntries(
      Object.entries(data).map(([mimeType, content]) => [
        mimeType,
        { type: "inline" as const, data: content, metadata: metadata?.[mimeType] }
      ])
    );

    this.store.commit(events.multimediaDisplayOutputAdded({
      id: crypto.randomUUID(),
      cellId: cell.id,
      representations,
      position: outputPosition++,
      displayId,
    }));
  },

  // Multi-media execution result
  result: (data: MediaBundle, metadata?: Record<string, unknown>) => {
    const representations = Object.fromEntries(
      Object.entries(data).map(([mimeType, content]) => [
        mimeType,
        { type: "inline" as const, data: content, metadata: metadata?.[mimeType] }
      ])
    );

    this.store.commit(events.multimediaResultOutputAdded({
      id: crypto.randomUUID(),
      cellId: cell.id,
      representations,
      executionCount: queueEntry.executionCount,
      position: outputPosition++,
    }));
  },

  // Error output
  error: (ename: string, evalue: string, traceback: string[]) => {
    this.store.commit(events.errorOutputAdded({
      id: crypto.randomUUID(),
      cellId: cell.id,
      content: { 
        type: "inline", 
        data: { ename, evalue, traceback } as ErrorOutputData 
      },
      position: outputPosition++,
    }));
  },

  // Clear outputs (with wait support)
  clear: (wait: boolean = false) => {
    this.store.commit(events.cellOutputsCleared({
      cellId: cell.id,
      wait,
      clearedBy: `kernel-${this.config.kernelId}`,
    }));
  }
};
```

## Implementation Steps

### Phase 1: Schema Updates (Days 1-3)
1. [ ] Add `MediaRepresentationSchema` definition
2. [ ] Add all new events (`multimedia*`, `terminal*`, `markdown*`, `error*`)
3. [ ] Add `pendingClears` table
4. [ ] Update `cellOutputsCleared` with `wait` field
5. [ ] Implement new materializers with pending clear logic
6. [ ] **Remove old `cellOutputAdded` event** (breaking change)

### Phase 2: Runtime Integration (Days 4-7)  
1. [ ] Update ExecutionContext methods in `runtime-agent.ts`
2. [ ] Map MediaBundle to representations structure
3. [ ] Test all output methods (stdout, stderr, display, result, error, clear)
4. [ ] Verify `clear_output(wait=True)` scenarios

### Phase 3: Testing & Validation (Days 8-10)
1. [ ] Unit tests for all new materializers
2. [ ] Integration tests for ExecutionContext methods
3. [ ] Test pending clear logic thoroughly
4. [ ] Verify MediaBundle handling remains unchanged

## MediaBundle Integration

**Key insight**: Existing MediaBundle handling maps directly to new structure:
```typescript
// Current MediaBundle (from media/types.ts)
const mediaBundle = {
  "text/html": "<table>...</table>",
  "text/plain": "Data table",
  "application/json": { rows: [...] }
};

// Becomes representations in new events
const representations = {
  "text/html": { type: "inline", data: "<table>...</table>" },
  "text/plain": { type: "inline", data: "Data table" },
  "application/json": { type: "inline", data: { rows: [...] } }
};
```

**No changes needed**:
- `toAIMediaBundle()` function
- `validateMediaBundle()` function  
- All MIME type handling
- Custom `+json` extensions

## Testing Strategy

### Critical Test Cases
- [ ] matplotlib plots with PNG + text representations
- [ ] Long terminal sessions with mixed stdout/stderr
- [ ] `clear_output(wait=True)` with various output types
- [ ] Streaming append operations
- [ ] Error handling and display
- [ ] AI markdown responses

### Unit Tests to Add
```typescript
// Test pending clear logic
Deno.test("pending clear applies to all output types", () => {
  // Test that multimedia, terminal, markdown, error all check pending clears
});

// Test MediaBundle conversion
Deno.test("MediaBundle maps to representations correctly", () => {
  // Test display() and result() methods convert MediaBundle properly
});

// Test streaming appends  
Deno.test("terminal append operations work correctly", () => {
  // Test terminalOutputAppended events
});
```

## Breaking Changes Impact

### What Breaks
- All existing `cellOutputAdded` events become invalid
- ExecutionContext output methods emit different events
- Materializers completely rewritten
- Output table schema changes

### What's Preserved
- MediaBundle interface and all related functions
- ExecutionContext method signatures (same parameters)
- All MIME type handling and AI conversion
- Real-time collaboration functionality

## Rollback Strategy

If critical issues arise:
1. **Schema rollback**: Restore previous event definitions
2. **Runtime rollback**: Revert ExecutionContext methods
3. **Data migration**: May need event replay with old materializers

## Local Development Notes

This work will coordinate with anode changes, so ensure:
- Schema changes are published/linked for anode consumption
- Test both packages together during development
- Consider workspace linking for faster iteration

## Success Criteria

- [ ] All ExecutionContext methods emit new granular events
- [ ] MediaBundle integration works seamlessly  
- [ ] Pending clear logic works for all output types
- [ ] Performance equal or better than current system
- [ ] All existing output scenarios continue working
- [ ] Type safety improved (no optional fields)

## Related Work

- Anode client updates happening in parallel
- Schema package shared between both workspaces
- See `anode/HANDOFF.md` for client-side changes
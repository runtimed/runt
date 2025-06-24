# Streaming Output Implementation Handoff

This document describes the streaming output functionality implemented for AI token streaming and real-time output in the runt runtime agent library.

## What Was Built

### 1. Unfiltered Stream Methods
Added `stdoutRaw()` and `stderrRaw()` methods to ExecutionContext that preserve ALL tokens including empty strings and whitespace.

**Problem Solved**: The existing `stdout()` and `stderr()` methods filter out empty/whitespace content with `text.trim()`, which breaks AI token streaming where spaces and empty tokens matter.

**API**:
```typescript
context.stdoutRaw("Hello");  // ✅ Gets through
context.stdoutRaw(" ");      // ✅ Gets through (not filtered)
context.stdoutRaw("");       // ✅ Gets through (not filtered)
```

### 2. Display Data Replacement  
Added `displayReplace()` method for updating entire display data content in place.

**Use Case**: AI responses that build up complete markdown content and replace it each time.

**API**:
```typescript
const outputId = crypto.randomUUID();
context.display({
  "text/markdown": "# AI Response\n\n_Thinking..._"
});

// Replace with growing content
context.displayReplace(outputId, {
  "text/markdown": "# AI Response\n\nHere's my complete answer..."
});
```

### 3. Display Data Append (rawSqlEvent)
Added `displayAppend()` method for efficient token-by-token appending using SQL concatenation.

**Use Case**: True streaming where you only send new tokens, not full content.

**API**:
```typescript
const outputId = crypto.randomUUID();
context.display({
  "text/markdown": "# AI Response\n\n"
});

// Append each token efficiently
context.displayAppend(outputId, "text/markdown", "Hello");
context.displayAppend(outputId, "text/markdown", " ");
context.displayAppend(outputId, "text/markdown", "world!");
// Result: "# AI Response\n\nHello world!"
```

## Implementation Details

### Events Added
- `cellOutputReplaced`: Replaces entire display data content
- Uses `rawSqlEvent` for `displayAppend` (no custom event needed)

### SQL Operations
The `displayAppend` method uses `rawSqlEvent` with SQLite JSON operations:

```sql
UPDATE outputs 
SET data = json_set(
  data, 
  '$.text/markdown', 
  COALESCE(json_extract(data, '$.text/markdown'), '') || 'new_token'
) 
WHERE id = 'output_id'
```

Key features:
- `COALESCE()` handles non-existent fields gracefully
- `json_set()` updates specific content type
- `||` operator for safe string concatenation
- Atomic operations prevent race conditions

### File Changes
- `packages/schema/mod.ts`: Added `cellOutputReplaced` event
- `packages/lib/src/types.ts`: Added new ExecutionContext methods
- `packages/lib/src/runtime-agent.ts`: Implemented methods with rawSqlEvent
- `packages/lib/src/execution-context.test.ts`: Comprehensive test coverage
- `packages/lib/test/display-append-integration.test.ts`: SQL verification tests

## Testing

### Mock Tests (47 test steps)
- API correctness and parameter validation
- Token-by-token streaming scenarios
- Multiple content type handling
- Empty/whitespace token preservation

### SQL Verification Tests (4 test steps)  
- Actual SQL generation verification
- COALESCE handling for missing fields
- Parameter binding correctness
- rawSqlEvent structure validation

## Performance Characteristics

### Unfiltered Stream Methods
- **Pro**: Every token creates immediate LiveStore commit
- **Pro**: Real-time feedback for users
- **Con**: Many small events for long responses

### Display Replace
- **Pro**: Simple implementation, complete state updates
- **Pro**: Easy to understand and debug
- **Con**: Sends full content each time (bandwidth)

### Display Append  
- **Pro**: Most efficient - only sends new tokens
- **Pro**: Atomic SQL operations prevent race conditions
- **Pro**: Handles missing fields gracefully
- **Con**: More complex implementation

## Usage Recommendations

**For AI `text/markdown` responses**:
1. Use `displayAppend()` for token-by-token streaming (most efficient)
2. Use `displayReplace()` when building up complete content
3. Use `stdoutRaw()` for plain text token streaming

**For debugging/development**:
- `stdoutRaw()` is simplest and most reliable
- `displayReplace()` is easiest to understand
- `displayAppend()` requires understanding SQL operations

## Future Considerations

### Potential Optimizations
- Batching multiple `displayAppend` calls within a single execution cycle
- Configurable flush timeouts for append operations
- Compression for large content updates

### Edge Cases Handled
- Empty and whitespace-only tokens
- Non-existent content types (via COALESCE)
- Rapid sequential append operations
- Multiple content types on same output

### Known Limitations
- `displayAppend` relies on SQLite JSON functions
- No built-in rate limiting for rapid append operations
- SQL injection protection relies on parameterized queries

## Branch Info
- Branch: `feature/streaming-output-methods`
- All tests passing (51 total test steps)
- Ready for code review and merge
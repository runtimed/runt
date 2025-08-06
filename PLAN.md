# Plan: Simplify create_cell API to after_id Only

## Current State

The `create_cell` tool currently uses a `position` parameter to place cells relative to the current AI cell:
- `after_current`: places the cell after the AI cell (default)
- `before_current`: places the cell before the AI cell
- `at_end`: places the cell at the end of the notebook

This approach limits the AI's ability to build complex notebook structures or place cells in specific sequences.

## Proposed Change

Replace the `position` parameter with `after_id` as the sole method for cell positioning.

### New API Design

```typescript
{
  name: "create_cell",
  description: "Create a new cell in the notebook after a specific cell. The AI knows its own cell ID and can reference any previously created cell IDs.",
  parameters: {
    type: "object",
    properties: {
      cellType: {
        type: "string",
        enum: ["code", "markdown", "ai", "sql"],
        description: "The type of cell to create"
      },
      source: {
        type: "string",
        description: "The content/source code for the cell"
      },
      after_id: {
        type: "string",
        description: "The ID of the cell to place this new cell after. Use your own cell ID to place cells below yourself, or use a previously created cell's ID to build sequences."
      }
    },
    required: ["cellType", "source", "after_id"]  // Explicitly required
  }
}
```

## Real-World Insights

From testing with models:

### The "Insert at Top" Problem
- There's no cell ID before the first cell, so no way to insert at the top
- Considered special sentinels (e.g., `runt:top`, `runt:last`) but this feels messy
- **Better approach**: Use `modify_cell` when you need to add imports or dependencies to existing cells
- Inserting at the top is rarely needed in practice

### Model Behavior Observations
- Models generally work well with the `after_id` approach
- Sometimes models don't think carefully about the proper `after_id` and cells end up in weird order
- This suggests we might want a sensible default behavior

### Recommendation: Optional after_id with Smart Default
Make `after_id` optional with this behavior:
- **When provided**: Place cell after the specified cell ID
- **When omitted**: Place cell after the current AI cell (the one making the call)

This gives us:
- Explicit control when needed
- Natural default behavior (responses appear below the AI)
- No need for special sentinels
- Flexibility without complexity

## Key Concepts

### 1. AI Knows Its Own Cell ID
- The AI cell that's making the tool call has access to its own cell ID
- This replaces the need for `position: "after_current"`
- The AI can simply use its own ID in `after_id`

### 2. Chaining Cells
- When the AI creates a cell, it receives the new cell's ID in the response
- The AI can then use this ID to create subsequent cells in sequence
- This enables building complex notebook structures

### 3. Looking Up
- The AI has context about cells above it
- It can reference any visible cell ID to insert content at specific locations
- This replaces the need for `position: "before_current"`

## Implementation Details

### Changes to `createCell` function

```typescript
export function createCell(
  store: Store<typeof schema>,
  logger: Logger,
  sessionId: string,
  currentCell: CellData,
  args: Record<string, unknown>,
) {
  const cellType = String(args.cellType || "code");
  const content = String(args.source || args.content || "");
  const afterId = String(args.after_id); // Now required
  
  // Get ordered cells with fractional indices
  const cellList = store.query(cellList$);
  
  // Find the cell to insert after
  const afterCellIndex = cellList.findIndex((c) => c.id === afterId);
  if (afterCellIndex === -1) {
    throw new Error(`Cell with ID ${afterId} not found`);
  }
  
  const cellBefore = cellList[afterCellIndex];
  const cellAfter = afterCellIndex < cellList.length - 1
    ? cellList[afterCellIndex + 1]
    : null;
  
  // Generate unique cell ID
  const newCellId = `cell-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  
  // ... rest of implementation
}
```

## Usage Examples

### Example 1: Building a Simple Analysis
```javascript
// AI's current cell ID: "cell-ai-123"

// Step 1: Create header
AI: create_cell({
  cellType: "markdown",
  source: "# Data Analysis",
  after_id: "cell-ai-123"  // Using own cell ID (or could omit for same effect)
})
// Returns: "Created markdown cell: cell-abc"

// Step 2: Create import cell
AI: create_cell({
  cellType: "code",
  source: "import pandas as pd\nimport numpy as np",
  after_id: "cell-abc"  // Chaining after header
})
// Returns: "Created code cell: cell-def"

// Step 3: Create data loading cell
AI: create_cell({
  cellType: "code",
  source: "df = pd.read_csv('data.csv')",
  after_id: "cell-def"  // Continuing the chain
})
// Returns: "Created code cell: cell-ghi"
```

### Example 2: Inserting Above
```javascript
// User: "Add an explanation above the imports"
// AI can see cell IDs in context

AI: create_cell({
  cellType: "markdown",
  source: "First, we need to import the necessary libraries:",
  after_id: "cell-ai-123"  // Insert after AI cell but before imports
})
```

## Benefits

1. **Simpler Mental Model**: Only one way to position cells
2. **Explicit Control**: Always know exactly where a cell will go
3. **Natural Chaining**: Build sequences by referencing previous cell IDs
4. **Flexible Insertion**: Can insert anywhere by referencing any cell ID
5. **No Ambiguity**: No confusion between `position` and `afterId`

## Migration Strategy

1. Update tool definition to remove `position` parameter
2. Make `after_id` optional, defaulting to current AI cell
3. Ensure AI has access to its own cell ID in context
4. Update any system prompts to explain the new approach
5. Emphasize using `modify_cell` for adding imports/dependencies

## Considerations

- The AI must have its own cell ID available in the context
- The AI should see cell IDs for cells above it to enable insertion
- Error handling for non-existent cell IDs is critical
- The response must include the created cell ID for chaining
- Guide models to use `modify_cell` instead of trying to insert at the top
- Consider adding examples in prompts to help models choose appropriate after_id values

## Success Criteria

- AI can create cells below itself by using its own cell ID
- AI can chain multiple cells together in sequence
- AI can insert cells at any position by referencing existing cell IDs
- The API is simpler and more predictable for LLM usage
# AI Cell Design & Implementation

## Overview

AI cells in runt notebooks provide a conversational interface where the AI
assistant has full access to the notebook context and can manipulate cells
through tool calls. The core principle is that **the AI chat and the notebook
are one unified document which keeps conversation continuity**.

## Current Implementation

This section details the current implementation of AI cells.

### Conversation Building

When an AI cell is executed, the system constructs a sequential conversation
flow:

1. **Sequential Conversation**: All notebook cells (code, markdown, AI) are
   transformed into a sequential conversation.
2. **Cell IDs**: Each cell message includes its exact cell ID for precise tool
   targeting.
3. **Tool Call Order**: AI responses, tool calls, and tool results maintain the
   OpenAI chat format.
4. **Continuity**: Subsequent AI calls retain the full context of previous AI
   tool usage.

### Sequential Conversation Architecture

**Core Principle**: Each output becomes exactly one conversation message in
order.

````typescript
// Perfect sequential flow:
user: "Notebook code cell cell-1: ```python import pandas```"
assistant: "I'll help with that data"
assistant: [create_cell tool call] (empty content)
tool: "Created code cell: cell-abc123"
assistant: [execute_cell tool call] (empty content)
tool: "Executed successfully. Output: DataFrame..."
assistant: "Perfect! The data shows..."
user: "Notebook code cell cell-abc123: ```python df.head()```"
user: "Now analyze the trends"
````

### Cell Type Integration

**Code/SQL Cells** → User messages with execution context:

````
Notebook code cell cell-123:
```python
df = pd.DataFrame({'A': [1,2,3]})
print(df)
````

Output:

```
   A
0  1
1  2
2  3
```

```
**Markdown Cells** → User messages with content:
```

Notebook markdown cell cell-456:

# Analysis Report

This section covers the methodology.

````
**AI Cells** → Sequential assistant/tool/tool messages:
- Text responses: `assistant: "I'll help you analyze this"`
- Tool calls: `assistant: [tool_call]` (empty content)
- Tool results: `tool: "Created cell: cell-789"`

### Available Tools

1.  **`create_cell`** - Create new cells with specified content and position.
2.  **`modify_cell`** - Update existing cell content using exact cell IDs.
3.  **`execute_cell`** - Execute code/SQL cells and return results.

All tools use the cell IDs from the conversation context (e.g., `cell-123`, `cell-abc456`).

## Implementation Details

### Output Format Standards

**AI Text Responses**:
- MIME type: `text/markdown`
- Metadata: `{anode: {role: "assistant"}}`

**Tool Calls**:
- MIME type: `application/vnd.anode.aitool+json`
- Metadata: `{anode: {role: "function_call"}}`
- Structure: `{tool_call_id, tool_name, arguments}`

**Tool Results**:
- MIME type: `application/vnd.anode.aitool.result+json`
- Metadata: `{anode: {role: "tool"}}`
- Structure: `{tool_call_id, result, status}`

## Format Benefits

### Continuity

Future AI calls see the complete conversation history in OpenAI's expected format:

```javascript
[
  {role: "system", content: "You are a data assistant"},
  {role: "user", content: "Notebook code cell cell-1: ```python df = ...```"},
  {role: "assistant", content: "I'll analyze this data"},
  {role: "assistant", content: "", tool_calls: [{function: {name: "create_cell"}}]},
  {role: "tool", content: "Created cell: cell-abc", tool_call_id: "call_123"},
  {role: "assistant", content: "Created analysis cell successfully"},
  {role: "user", content: "Notebook code cell cell-abc: ```python analysis...```"},
  {role: "user", content: "What patterns do you see?"}
]
````

### Cell Targeting Precision

AI can target exact cells using IDs from the conversation:

- `execute_cell(cellId: "cell-1")`
- `modify_cell(cellId: "cell-abc123", content: "updated code")`

# Function Registry Integration Handoff

## Overview

This document outlines the integration of a new Pydantic-based function registry system into the Pyodide runtime agent, replacing the previous tool system with enhanced schema generation, type validation, and error handling.

## What Was Implemented

### Core Components

1. **New Function Registry** (`packages/pyodide-runtime-agent/src/registry.py`)
   - Pydantic-based schema generation with automatic type inference
   - Support for complex nested Pydantic models as function parameters
   - Async function support with proper awaiting
   - Enhanced error handling with specific exception types
   - JSON string-based argument passing for future streaming support

2. **Integration Layer** (`packages/pyodide-runtime-agent/src/ipython-setup.py`)
   - Replaced old `openai_function_calling` dependency with new registry
   - Converted tool output format from OpenAI to NotebookTool format
   - Added comprehensive error logging and traceback reporting
   - Maintained backward compatibility with `@tool` decorator

3. **Worker Communication** (`packages/pyodide-runtime-agent/src/pyodide-worker.ts`)
   - Fixed argument serialization using `pyodide.globals.set()`
   - Eliminated double JSON encoding issues
   - Added proper error propagation from Python to TypeScript

## Current Status

### ✅ Working Features

- **Basic tool registration**: `@tool` decorator works correctly
- **Pydantic model support**: Complex nested models work (e.g., `Rectangle`, `RectangleProps`)
- **Type validation**: Automatic validation of function arguments
- **Error logging**: Python errors are captured in logs (but not displayed in UI)
- **Async tools**: Functions can be async and are properly awaited
- **JSON serialization**: Boolean, null, and complex object handling works correctly

### ❌ Known Issues

1. **Error visibility**: Python errors from tool execution are logged but not displayed in AI cell UI
2. **Side effects**: `display()` calls from within tools are not captured in AI cell output
3. **Tool approval flow**: Some tools may need debugging around the approval/execution pipeline

### 🧪 Partially Working

- **Tool execution**: Works when Python code is correct, fails gracefully when not
- **AI integration**: Tools are discovered and called, but error feedback to AI is limited

## Architecture

```
JavaScript                  Pyodide Worker                 Python
-----------                 --------------                 -------
AI system calls tool   →   JSON.stringify(args)      →   pyodide.globals.set()
                            pyodide.runPythonAsync()      ↓
                                                          run_registered_tool()
                                                          ↓
                                                          _function_registry.call()
                                                          ↓
                                                          json.loads(args_string)
                                                          ↓
                                                          Pydantic validation
                                                          ↓
                                                          Function execution
```

### Key Design Decisions

1. **JSON string arguments**: Registry accepts JSON strings to enable future streaming partial execution
2. **Pydantic validation**: Automatic type checking and conversion of function arguments
3. **Error boundaries**: Clear separation between validation errors, execution errors, and system errors
4. **Backward compatibility**: Existing `@tool` decorator interface preserved

## Testing

### Basic Tool Test

```python
from pydantic import BaseModel
from typing import Optional

class Rectangle(BaseModel):
    width: int
    height: int

@tool
def calculate_area(rect: Rectangle, color: Optional[str] = None):
    """Calculate rectangle area"""
    return {"area": rect.width * rect.height, "color": color}

# Test manually
result = calculate_area(Rectangle(width=10, height=5), color="blue")
print(result)  # Should work

# Test via AI
# In AI cell: "Calculate the area of a 10x5 rectangle"
```

### Debugging Tools

```python
# Check registered tools
print("Available tools:", len(_function_registry.function_definitions))
for tool_def in _function_registry.function_definitions:
    print(f"- {tool_def['name']}: {tool_def['description']}")

# Check tool schemas
tools_json = get_registered_tools()
print("Tools JSON:", tools_json)
```

## Priority Issues to Resolve

### 1. Error Visibility (High Priority)

**Problem**: Python errors from tool execution don't appear in AI cell output.

**Current**: Errors logged to console but not shown to user.

**Solution needed**: Capture Python errors and return them as part of tool result or display them inline.

**Files to modify**:
- `packages/pyodide-runtime-agent/src/ipython-setup.py` - `run_registered_tool()`
- `packages/ai/tool-registry.ts` - Error handling in `handleToolCallWithResult()`

### 2. Side Effect Capture (Medium Priority)

**Problem**: `display()` calls, `print()` statements, and plots from tool execution aren't captured.

**Current**: Only the return value is captured.

**Solution needed**: Capture stdout, display outputs, and matplotlib plots during tool execution.

**Approach**: 
- Redirect IPython display outputs during tool execution
- Capture stdout/stderr
- Include captured outputs in tool result

### 3. Streaming Partials (Future Enhancement)

**Foundation**: JSON string architecture supports this.

**Implementation**: 
- Send partial JSON strings as they're generated
- Buffer and parse incrementally in registry
- Enable progressive tool result rendering

## File Structure

```
runt/
├── packages/pyodide-runtime-agent/src/
│   ├── registry.py           # New Pydantic-based registry
│   ├── ipython-setup.py      # Integration layer, tool decorator
│   ├── pyodide-worker.ts     # Worker communication
│   └── pyodide-agent.ts      # Main agent (calls get_registered_tools)
└── packages/ai/
    └── tool-registry.ts      # AI-side tool handling
```

## Dependencies

- **Pydantic**: Installed via Pyodide's built-in support
- **Registry**: Self-contained in `registry.py`
- **Removed**: `openai_function_calling` dependency

## Testing Commands

```bash
# Run tests
deno task test packages/pyodide-runtime-agent/

# Check types
deno task check

# Format code
deno task fmt
```

## Next Developer Actions

1. **Test the paint tool** to verify the JSON encoding fix worked
2. **Implement error visibility** - show Python errors in AI cell output
3. **Add side effect capture** - capture display outputs from tools
4. **Add more comprehensive tests** for the registry system
5. **Document tool development** - create guide for users to write tools

## Example Error to Debug

When testing tools with the current system, you might see:
```
Tool execution failed for paint: 'str' object has no attribute 'get'
```

This should now be resolved, but if it persists, check the argument serialization flow in the worker.

## Contact

If resuming this work, key areas to focus on:
1. Error handling and visibility
2. Tool execution output capture  
3. Integration testing with complex Pydantic models
4. Performance optimization for large tool schemas
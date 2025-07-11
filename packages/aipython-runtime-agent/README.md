# AIPython Runtime Agent

AI-powered Python execution simulation for Anode notebooks.

## Overview

AIPython is a runtime agent that uses AI to simulate IPython execution by providing the AI with tools that are directly connected to the execution context output methods. Instead of actually executing Python code, it uses an AI model to simulate what the output would be, making it perfect for educational purposes, prototyping, or situations where you can't run actual Python code.

## Features

- 🧠 **AI-powered execution**: Uses OpenAI's GPT models to simulate Python execution
- 🔧 **Real tool integration**: AI uses actual IPython tools (`stdout`, `stderr`, `execute_result`, `display`, `error`)
- 📚 **Conversation memory**: Maintains session state across multiple code executions
- 🎯 **Accurate simulation**: Behaves like real IPython with proper output formatting
- 🚀 **Real-time streaming**: Outputs appear in real-time just like actual execution

## Installation

```bash
# Install dependencies
deno install --allow-all --name aipython jsr:@runt/aipython-runtime-agent/bin/aipython
```

## Configuration

### Environment Variables

Required:

- `OPENAI_API_KEY`: Your OpenAI API key
- `NOTEBOOK_ID`: Anode notebook ID to connect to
- `AUTH_TOKEN`: Authentication token for the notebook

Optional:

- `AIPYTHON_MODEL`: AI model to use (default: `gpt-4o-mini`)
- `LIVESTORE_SYNC_URL`: Custom LiveStore sync URL

### Example `.env` file

```bash
OPENAI_API_KEY=sk-your-openai-key-here
NOTEBOOK_ID=my-notebook-id
AUTH_TOKEN=your-auth-token
AIPYTHON_MODEL=gpt-4o-mini
```

## Usage

### Command Line

```bash
# Start the agent
aipython --notebook my-notebook --auth-token your-token

# Or with environment variables
export NOTEBOOK_ID=my-notebook
export AUTH_TOKEN=your-token
aipython
```

### Programmatic Usage

```typescript
import { AIPythonAgent } from "@runt/aipython-runtime-agent";

const agent = new AIPythonAgent({
  model: "gpt-4o-mini",
  maxHistoryLength: 20,
  includeOutputs: true,
});

await agent.start();
await agent.keepAlive();
```

## How It Works

1. **Code Execution**: When you run Python code in the notebook, it's sent to the AI
2. **Tool Calling**: The AI uses provided tools to emit outputs:
   - `stdout()` - for print statements and console output
   - `stderr()` - for warnings and error messages
   - `execute_result()` - for expression results (like `2 + 3` → `5`)
   - `display()` - for rich content like plots and HTML
   - `error()` - for Python errors with proper tracebacks
3. **State Management**: Previous code and outputs are sent as context to maintain session state
4. **Real-time Output**: All outputs appear in the notebook in real-time

## Example Interactions

### Basic Expression

```python
2 + 3
```

→ AI uses `execute_result({"text/plain": "5"})`

### Print Statement

```python
print("Hello, World!")
```

→ AI uses `stdout("Hello, World!\n")`

### Error Handling

```python
x = 1 / 0
```

→ AI uses `error("ZeroDivisionError", "division by zero", [traceback...])`

### Rich Display

```python
import matplotlib.pyplot as plt
plt.plot([1, 2, 3], [1, 4, 9])
plt.show()
```

→ AI uses `display({"image/png": "...", "text/plain": "plot description"})`

## Configuration Options

| Option             | Default                  | Description                         |
| ------------------ | ------------------------ | ----------------------------------- |
| `model`            | `gpt-4o-mini`            | OpenAI model to use                 |
| `apiKey`           | `OPENAI_API_KEY` env var | OpenAI API key                      |
| `maxHistoryLength` | `20`                     | Max conversation entries to send    |
| `includeOutputs`   | `true`                   | Include previous outputs in context |

## Available Tools

The AI has access to these IPython-like tools:

- **`stdout(text)`** - Write to stdout stream
- **`stderr(text)`** - Write to stderr stream
- **`execute_result(data, metadata?)`** - Return expression results
- **`display(data, metadata?)`** - Display rich content
- **`error(ename, evalue, traceback)`** - Report Python errors

## Limitations

- **No actual execution**: This is simulation only - no real Python code runs
- **AI knowledge cutoff**: Limited to what the AI model knows about Python
- **API costs**: Each code execution makes API calls to OpenAI
- **No persistent variables**: State is maintained through conversation, not actual Python variables

## Development

```bash
# Run in development mode
deno task dev

# Run tests
deno task test

# Type check
deno task check
```

## License

Same as the parent Runt project.

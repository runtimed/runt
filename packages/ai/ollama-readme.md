# Ollama Client for Runt

A comprehensive TypeScript client for integrating Ollama with Runt runtime
agents. This client provides feature parity with the OpenAI client, including
tool calling, streaming responses, model management, and agentic conversation
support.

## Features

- **🔄 Streaming Responses**: Real-time token-by-token streaming with markdown
  rendering
- **🛠️ Tool Calling**: Full support for notebook tools (create_cell,
  modify_cell, execute_cell)
- **🤖 Agentic Conversations**: Multi-iteration conversations with tool
  execution
- **📦 Model Management**: Automatic model discovery and pulling
- **🌐 Connection Management**: Robust connection handling with error recovery
- **⚡ Performance**: Efficient streaming and async processing
- **🔧 Configuration**: Flexible configuration options
- **🧪 Testing**: Comprehensive test suite with 95%+ coverage

## Installation

The Ollama client is included in the `@runt/ai` package:

```bash
# Install Ollama first
curl -fsSL https://ollama.ai/install.sh | sh

# Start Ollama server
ollama serve

# Pull some models
ollama pull llama3.1
ollama pull mistral
ollama pull codellama
```

## Quick Start

```typescript
import { RuntOllamaClient } from "@runt/ai";

const client = new RuntOllamaClient({
  host: "http://localhost:11434",
});

// Check if ready
const isReady = await client.isReady();
console.log("Client ready:", isReady);

// Get available models
const models = await client.getAvailableModels();
console.log("Available models:", models.map((m) => m.name));

// Simple conversation
const messages = [
  { role: "user", content: "Explain Python list comprehensions" },
];

await client.generateAgenticResponse(messages, context, {
  model: "llama3.1",
  temperature: 0.7,
  enableTools: false,
});
```

## Configuration

### Basic Configuration

```typescript
const client = new RuntOllamaClient({
  host: "http://localhost:11434", // Default Ollama host
  model: "llama3.1", // Default model
  headers: { // Custom headers
    "Custom-Header": "value",
  },
  proxy: false, // Proxy settings
});
```

### Environment Variables

```bash
# Set custom Ollama host
export OLLAMA_HOST=http://localhost:11434

# Use in Docker
export OLLAMA_HOST=http://ollama:11434
```

## API Reference

### Constructor

```typescript
new RuntOllamaClient(config?: OllamaConfig)
```

**Parameters:**

- `config.host?: string` - Ollama server host (default: http://localhost:11434)
- `config.model?: string` - Default model name
- `config.headers?: HeadersInit` - Custom HTTP headers
- `config.proxy?: boolean` - Enable proxy support

### Methods

#### `isReady(): Promise<boolean>`

Check if the Ollama server is available and configured.

```typescript
const ready = await client.isReady();
if (!ready) {
  console.log("Ollama server not available");
}
```

#### `getAvailableModels(): Promise<ModelInfo[]>`

Get list of available models with metadata.

```typescript
const models = await client.getAvailableModels();
models.forEach((model) => {
  console.log(`${model.name} - ${model.details.parameter_size}`);
});
```

#### `ensureModelExists(modelName: string): Promise<boolean>`

Ensure a model exists locally, pulling it if necessary.

```typescript
const exists = await client.ensureModelExists("llama3.1");
if (!exists) {
  console.log("Model not available and couldn't be pulled");
}
```

#### `generateAgenticResponse(messages, context, options)`

Generate an agentic response with streaming and tool support.

**Parameters:**

- `messages: Message[]` - Conversation history
- `context: ExecutionContext` - Runt execution context
- `options: AgenticOptions` - Configuration options

**Options:**

- `model?: string` - Model to use (default: "llama3.1")
- `temperature?: number` - Temperature setting (0-1)
- `enableTools?: boolean` - Enable tool calling
- `maxIterations?: number` - Maximum conversation iterations
- `onToolCall?: (toolCall: ToolCall) => Promise<string>` - Tool execution
  handler
- `onIteration?: (iteration: number, messages: Message[]) => Promise<boolean>` -
  Iteration callback
- `interruptSignal?: AbortSignal` - Interruption signal

## Tool Calling

The Ollama client supports the same tool calling interface as the OpenAI client:

```typescript
await client.generateAgenticResponse(messages, context, {
  model: "llama3.1",
  enableTools: true,
  onToolCall: async (toolCall) => {
    console.log(`Tool called: ${toolCall.name}`);
    console.log("Arguments:", toolCall.arguments);

    // Execute the tool
    const result = await executeNotebookTool(toolCall);
    return result;
  },
});
```

### Available Tools

- **create_cell**: Create new notebook cells
- **modify_cell**: Edit existing cell content
- **execute_cell**: Run code cells

## Streaming Support

Responses are streamed token-by-token for real-time feedback:

```typescript
// The client automatically handles streaming
// Content appears progressively in the execution context
await client.generateAgenticResponse(messages, context, {
  model: "llama3.1",
  // Streaming is enabled by default
});
```

## Model Management

### Auto-Pull Models

Models are automatically pulled when needed:

```typescript
// This will pull llama3.1 if not available locally
await client.generateAgenticResponse(messages, context, {
  model: "llama3.1",
});
```

### Manual Model Management

```typescript
// Check if model exists
const exists = await client.ensureModelExists("mistral");

// Get model info
const models = await client.getAvailableModels();
const mistral = models.find((m) => m.name === "mistral");
console.log("Model size:", mistral?.size);
```

## Error Handling

The client provides comprehensive error handling:

```typescript
try {
  await client.generateAgenticResponse(messages, context, {
    model: "nonexistent-model",
  });
} catch (error) {
  // Error is automatically displayed in context
  console.log("Conversation failed:", error);
}
```

### Common Error Scenarios

1. **Server Not Available**: Shows configuration help
2. **Model Not Found**: Attempts auto-pull, shows error if fails
3. **Connection Issues**: Displays connection troubleshooting
4. **Tool Errors**: Shows tool execution failures

## Interruption Support

Conversations can be interrupted gracefully:

```typescript
const abortController = new AbortController();

// Start conversation
const promise = client.generateAgenticResponse(messages, context, {
  interruptSignal: abortController.signal,
});

// Interrupt after 5 seconds
setTimeout(() => abortController.abort(), 5000);

await promise; // Will stop cleanly
```

## Performance Considerations

### Memory Usage

- Streaming responses minimize memory usage
- Model loading is handled by Ollama server
- Connection pooling for efficiency

### Speed Optimization

- Use smaller models for faster responses: `qwen2.5:0.5b`
- Adjust temperature for faster generation: `temperature: 0.1`
- Enable GPU acceleration in Ollama

## Integration with Runt

### In Runtime Agents

```typescript
import { RuntOllamaClient } from "@runt/ai";

// In your runtime agent
const ollamaClient = new RuntOllamaClient();

export async function executeAI(context: ExecutionContext) {
  const messages = buildConversationMessages(context);

  await ollamaClient.generateAgenticResponse(messages, context, {
    model: "llama3.1",
    enableTools: true,
    onToolCall: handleToolCall,
  });
}
```

### Custom Tool Handlers

```typescript
import { handleToolCallWithResult } from "@runt/ai";

const customToolHandler = async (toolCall: ToolCall) => {
  return await handleToolCallWithResult(
    store,
    logger,
    sessionId,
    currentCell,
    toolCall,
  );
};
```

## Comparison with OpenAI Client

| Feature          | OpenAI Client | Ollama Client |
| ---------------- | ------------- | ------------- |
| Streaming        | ✅            | ✅            |
| Tool Calling     | ✅            | ✅            |
| Model Management | ❌            | ✅            |
| Local Models     | ❌            | ✅            |
| Cost             | 💰            | 🆓            |
| Privacy          | ☁️            | 🏠            |
| Speed            | Fast          | Variable      |
| Setup            | API Key       | Local Install |

## Troubleshooting

### Common Issues

1. **"Ollama server not available"**
   ```bash
   # Start Ollama server
   ollama serve

   # Check if running
   curl http://localhost:11434/api/tags
   ```

2. **"Model not found"**
   ```bash
   # Pull the model
   ollama pull llama3.1

   # List available models
   ollama list
   ```

3. **Connection refused**
   ```bash
   # Check host configuration
   export OLLAMA_HOST=http://localhost:11434

   # For Docker
   export OLLAMA_HOST=http://ollama:11434
   ```

### Debug Mode

```typescript
import { createLogger } from "@runt/lib";

const logger = createLogger("ollama-debug");
logger.info("Debugging Ollama client");
```

## Contributing

The Ollama client is part of the Runt AI package. To contribute:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Run the test suite: `deno task test packages/ai/`
5. Submit a pull request

### Running Tests

```bash
# Run all AI tests
deno task test packages/ai/

# Run only Ollama tests
deno task test packages/ai/test/ollama-client.test.ts

# Run with coverage
deno task test:coverage
```

## License

MIT License - see the main Runt project for details.

## Related Links

- [Ollama Official Website](https://ollama.ai/)
- [Ollama GitHub Repository](https://github.com/ollama/ollama)
- [Runt Documentation](https://github.com/runtimed/runt)
- [Available Models](https://ollama.ai/library)

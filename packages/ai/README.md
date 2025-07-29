# @runt/ai

AI integration package for Runt runtime agents. This package provides AI clients
as part of the pluggable runtime layer, allowing notebook environments to
integrate with various AI providers when users opt-in to AI-powered features.

This is not a standalone AI client package - it's specifically designed for use
within Runt's runtime agent ecosystem (currently the pyodide agent, with more
runtime agents planned).

## Features

- **🤖 Multiple AI Providers**: OpenAI, Ollama, and Groq support with unified
  interface
- **🔄 Streaming Responses**: Real-time token-by-token streaming with markdown
  rendering
- **🛠️ Tool Calling**: Full support for notebook tools (create_cell,
  modify_cell, execute_cell)
- **🤖 Agentic Conversations**: Multi-iteration conversations with tool
  execution
- **📦 Dynamic Model Discovery**: Runtime-based model discovery with capability
  detection
- **🌐 Connection Management**: Robust connection handling with error recovery
- **⚡ Performance**: Efficient streaming and async processing
- **🔧 Configuration**: Flexible configuration options
- **🧪 Testing**: Comprehensive test suite with 95%+ coverage

## Integration with Runtime Agents

This package is automatically included when you use a Runt runtime agent that
supports AI features. Users can opt-in to AI functionality by:

1. Setting appropriate API keys (e.g., `OPENAI_API_KEY`, `GROQ_API_KEY`)
2. Installing and configuring local AI providers (e.g., Ollama)
3. Creating AI cells in their notebooks

The runtime agent handles all the integration - no manual installation required.

## Quick Start for Notebook Users

### Using AI Cells

Once your runtime agent has AI support enabled, you can create AI cells in your
notebook:

1. **Create an AI cell** - The cell type will be available in your notebook
   interface
2. **Set your provider** - Choose from OpenAI, Ollama, or Groq
3. **Write your prompt** - Ask questions, request analysis, or get coding help
4. **Execute** - The AI will respond with streaming text and can use tools to
   create/modify other cells

### Configuration

AI features are activated by setting environment variables:

```bash
# For OpenAI
export OPENAI_API_KEY=sk-your-key-here

# For Groq (faster inference)
export GROQ_API_KEY=gsk-your-key-here

# For Ollama (local AI)
export OLLAMA_HOST=http://localhost:11434
```

## Dynamic Model Discovery

The package supports runtime model discovery for both providers:

```typescript
import {
  discoverAvailableAiModels,
  filterModelsByCapabilities,
} from "@runt/ai";

// Discover all available models
const allModels = await discoverAvailableAiModels();
console.log(`Found ${allModels.length} models`);

// Filter by capabilities
const toolCapableModels = filterModelsByCapabilities(allModels, ["tools"]);
const visionModels = filterModelsByCapabilities(allModels, ["vision"]);

// Group by provider
const modelsByProvider = new Map();
for (const model of allModels) {
  if (!modelsByProvider.has(model.provider)) {
    modelsByProvider.set(model.provider, []);
  }
  modelsByProvider.get(model.provider).push(model);
}
```

### Model Capabilities

Models are automatically classified with these capabilities:

- **completion**: Basic text completion
- **tools**: Function/tool calling support
- **vision**: Image understanding
- **thinking**: Chain of thought reasoning
- **code**: Code generation/understanding
- **multimodal**: Multiple input types

## AI Client Interface

Both clients implement the same core interface:

```typescript
interface AiClient {
  generateAgenticResponse(
    messages: Message[],
    context: ExecutionContext,
    options: AgenticOptions,
  ): Promise<void>;

  isReady(): Promise<boolean>;
  discoverAiModels(): Promise<AiModel[]>;
}
```

### Agentic Response Options

```typescript
interface AgenticOptions {
  model?: string;
  temperature?: number;
  enableTools?: boolean;
  maxIterations?: number;
  onToolCall?: (toolCall: ToolCall) => Promise<string>;
  onIteration?: (iteration: number, messages: Message[]) => Promise<boolean>;
  interruptSignal?: AbortSignal;
}
```

## Tool Calling

Both clients support the same tool calling interface:

```typescript
await client.generateAgenticResponse(messages, context, {
  model: "gpt-4", // or "llama3.1"
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

### Tool Registry

The package includes a built-in tool registry:

```typescript
import { handleToolCallWithResult } from "@runt/ai";

const result = await handleToolCallWithResult(
  store,
  logger,
  sessionId,
  currentCell,
  toolCall,
);
```

## Configuration

### OpenAI Configuration

```typescript
const openaiClient = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://api.openai.com/v1", // Custom base URL
  organization: "org-123", // Organization ID
  project: "proj-456", // Project ID
});
```

### Ollama Configuration

```typescript
const ollamaClient = new RuntOllamaClient({
  host: "http://localhost:11434", // Default Ollama host
  model: "llama3.1", // Default model
  headers: {
    "Custom-Header": "value",
  },
});
```

### Environment Variables

```bash
# OpenAI
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://api.openai.com/v1

# Ollama
export OLLAMA_HOST=http://localhost:11434

# Groq
export GROQ_API_KEY=gsk_...
```

## Streaming Support

Both clients support real-time streaming:

```typescript
// Streaming is enabled by default
await client.generateAgenticResponse(messages, context, {
  model: "gpt-4",
  // Content appears progressively in the execution context
});
```

## Error Handling

Comprehensive error handling with contextual messages:

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

## Ollama Setup

For local AI with Ollama:

```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Start Ollama server
ollama serve

# Pull some models
ollama pull llama3.1
ollama pull mistral
ollama pull codellama
```

## Groq Setup

For fast cloud AI with Groq's dedicated client:

```bash
# Get API key from https://console.groq.com/keys
export GROQ_API_KEY=gsk_your_key_here

# Available models include:
# - llama-3.1-70b-versatile (recommended for quality)
# - llama-3.1-8b-instant (fastest)
# - llama3-70b-8192
# - llama3-8b-8192
# - mixtral-8x7b-32768
# - gemma2-9b-it
```

The Groq client uses the official Groq SDK for optimal performance and
reliability, providing faster inference than OpenAI while maintaining tool
calling capabilities.

## Model Management (Ollama)

```typescript
// Check if model exists
const exists = await client.ensureModelExists("llama3.1");

// Get available models
const models = await client.getAvailableModels();
models.forEach((model) => {
  console.log(`${model.name} - ${model.details.parameter_size}`);
});
```

## Integration with Runt

### In Runtime Agents

```typescript
import { OpenAIClient, RuntOllamaClient } from "@runt/ai";

// In your runtime agent
const aiClient = new OpenAIClient(); // or RuntOllamaClient

export async function executeAI(context: ExecutionContext) {
  const messages = buildConversationMessages(context);

  await aiClient.generateAgenticResponse(messages, context, {
    model: "gpt-4",
    enableTools: true,
    onToolCall: handleToolCall,
  });
}
```

### Runtime Capabilities

Include AI model discovery in your runtime capabilities:

```typescript
import { discoverAvailableAiModels } from "@runt/ai";

const capabilities = {
  runtimeType: "pyodide",
  availableAiModels: await discoverAvailableAiModels(),
  // ... other capabilities
};
```

## Provider Comparison

| Feature          | OpenAI Client | Ollama Client | Groq Client   |
| ---------------- | ------------- | ------------- | ------------- |
| Streaming        | ✅            | ✅            | ✅            |
| Tool Calling     | ✅            | ✅            | ✅            |
| Model Management | ❌            | ✅            | ❌            |
| Local Models     | ❌            | ✅            | ❌            |
| Cost             | 💰            | 🆓            | 💰 (Lower)    |
| Privacy          | ☁️            | 🏠            | ☁️            |
| Speed            | Fast          | Variable      | Very Fast     |
| Setup            | API Key       | Local Install | API Key       |
| SDK              | OpenAI SDK    | Custom        | Official Groq |

## API Reference

### Functions

- `discoverAvailableAiModels(): Promise<AiModel[]>` - Discover all available AI
  models
- `filterModelsByCapabilities(models: AiModel[], capabilities: string[]): AiModel[]` -
  Filter models by capabilities
- `handleToolCallWithResult(store, logger, sessionId, currentCell, toolCall): Promise<string>` -
  Execute tool calls

### Classes

- `OpenAIClient` - OpenAI API client with streaming and tool support
- `RuntOllamaClient` - Ollama client with local model management
- `GroqClient` - Groq client using official SDK for fast cloud inference

### Types

- `AiModel` - Model information with capabilities and metadata
- `ModelCapability` - Capability types (completion, tools, vision, etc.)
- `ToolCall` - Tool call structure with name and arguments
- `AgenticOptions` - Configuration options for agentic responses

## Troubleshooting

### OpenAI Issues

1. **"API key not found"**
   ```bash
   export OPENAI_API_KEY=sk-your-key-here
   ```

2. **Rate limiting**
   - Reduce temperature for faster responses
   - Implement exponential backoff
   - Use different models for different tasks

### Ollama Issues

1. **"Ollama server not available"**
   ```bash
   ollama serve
   curl http://localhost:11434/api/tags
   ```

2. **"Model not found"**
   ```bash
   ollama pull llama3.1
   ollama list
   ```

3. **Connection refused**
   ```bash
   export OLLAMA_HOST=http://localhost:11434
   ```

## Testing

```bash
# Run all AI tests
deno task test packages/ai/

# Run specific test files
deno task test packages/ai/test/ollama-client.test.ts
deno task test packages/ai/test/streaming-markdown.test.ts

# Run with coverage
deno task test:coverage
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Run the test suite: `deno task ci`
5. Submit a pull request

## License

BSD-3-Clause License - see the main Runt project for details.

## Related Links

- [Runt Documentation](https://github.com/runtimed/runt)
- [OpenAI API Documentation](https://platform.openai.com/docs)
- [Ollama Documentation](https://ollama.ai/)
- [Available Ollama Models](https://ollama.ai/library)

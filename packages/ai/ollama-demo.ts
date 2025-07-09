import { RuntOllamaClient } from "./ollama-client.ts";
import type { ExecutionContext } from "@runt/lib";
import process from "node:process";

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// Create a simple execution context mock for testing
const mockContext = {
  display: (
    data: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ) => {
    console.log("📊 Display:", JSON.stringify(data, null, 2));
    if (metadata) {
      console.log("   Metadata:", JSON.stringify(metadata, null, 2));
    }
  },
  markdown: (content: string, metadata?: Record<string, unknown>) => {
    console.log("📝 Markdown:", content);
    if (metadata) {
      console.log("   Metadata:", JSON.stringify(metadata, null, 2));
    }
    return `md-${Date.now()}`;
  },
  appendMarkdown: (_id: string, content: string) => {
    process.stdout.write(content);
  },
  error: (ename: string, evalue: string, traceback: string[]) => {
    console.log("❌ Error:", ename, evalue, traceback);
  },
};

// Demo function
async function demo() {
  console.log("🚀 Starting Ollama client demo...\n");

  const client = new RuntOllamaClient({
    host: "http://localhost:11434",
  });

  // Check if client is ready
  const isReady = await client.isReady();
  console.log("✅ Client ready:", isReady);

  if (!isReady) {
    console.log("❌ Ollama server not available. Please start Ollama first.");
    console.log("💡 Run: ollama serve");
    return;
  }

  // Get available models
  try {
    const models = await client.getAvailableModels();
    console.log(
      "📦 Available models:",
      models.map((m) => `${m.name} (${m.details.parameter_size})`),
    );

    if (models.length === 0) {
      console.log("💡 No models available. Try: ollama pull llama3.1");
      return;
    }
  } catch (error) {
    console.log("❌ Failed to get models:", error);
    return;
  }

  console.log("\n🤖 Starting conversations...\n");

  // Demo 1: Simple conversation
  console.log("=== Demo 1: Simple Conversation ===");
  const messages1 = [
    {
      role: "user" as const,
      content: "Explain Python list comprehensions in one sentence.",
    },
  ];

  try {
    await client.generateAgenticResponse(
      messages1,
      mockContext as ExecutionContext,
      {
        model: "llama3.1",
        temperature: 0.7,
        enableTools: false,
        maxIterations: 1,
      },
    );
  } catch (error) {
    console.log("❌ Simple conversation failed:", error);
  }

  console.log("\n\n=== Demo 2: Tool Usage (Mock) ===");

  // Demo 2: Tool usage (mocked)
  const messages2 = [
    {
      role: "user" as const,
      content: "Create a Python function that calculates fibonacci numbers.",
    },
  ];

  // Mock tool handler
  const mockToolHandler = async (toolCall: ToolCall) => {
    console.log(`\n🔧 Tool called: ${toolCall.name}`);
    console.log("📋 Arguments:", JSON.stringify(toolCall.arguments, null, 2));

    // Simulate tool execution
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return `Successfully executed ${toolCall.name}`;
  };

  try {
    await client.generateAgenticResponse(
      messages2,
      mockContext as ExecutionContext,
      {
        model: "llama3.1",
        temperature: 0.7,
        enableTools: true,
        maxIterations: 2,
        onToolCall: mockToolHandler,
      },
    );
  } catch (error) {
    console.log("❌ Tool conversation failed:", error);
  }

  console.log("\n\n=== Demo 3: Model Auto-Pull ===");

  // Demo 3: Test model auto-pull
  console.log("Testing model auto-pull for a small model...");
  try {
    const exists = await client.ensureModelExists("qwen2.5:0.5b");
    console.log("✅ Model availability:", exists);
  } catch (error) {
    console.log("❌ Model check failed:", error);
  }

  console.log("\n✨ Demo complete!");
  console.log("\n💡 Next steps:");
  console.log("- Start Ollama server: ollama serve");
  console.log("- Pull models: ollama pull llama3.1");
  console.log("- Try different models: mistral, codellama, qwen2.5");
  console.log("- Integrate with your Runt runtime agent!");
}

// Run the demo
if (import.meta.main) {
  demo().catch(console.error);
}

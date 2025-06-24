// AI Streaming Example - Demonstrates token-by-token streaming output

import { createRuntimeConfig, RuntimeAgent } from "@runt/lib";
import type { ExecutionContext } from "@runt/lib";

/**
 * Example AI streaming handler that demonstrates token-by-token output
 * using the new stdoutRaw method for unfiltered streaming
 */
class AIStreamingExample {
  private agent: RuntimeAgent;

  constructor() {
    // Create config from CLI args and environment variables
    const config = createRuntimeConfig(Deno.args, {
      kernelType: "ai-streaming",
      capabilities: {
        canExecuteCode: true,
        canExecuteSql: false,
        canExecuteAi: true,
      },
    });

    this.agent = new RuntimeAgent(config, config.capabilities);
  }

  async start() {
    // Register the AI streaming execution handler
    this.agent.onExecution(this.handleAIStreaming.bind(this));

    // Start the agent
    await this.agent.start();
    console.log("🤖 AI Streaming agent started");

    // Keep alive
    await this.agent.keepAlive();
  }

  async shutdown() {
    await this.agent.shutdown();
  }

  /**
   * AI streaming execution handler - demonstrates token streaming patterns
   */
  private async handleAIStreaming(context: ExecutionContext) {
    const { cell, stdout } = context;
    const prompt = cell.source || "";

    // Handle different streaming scenarios
    if (prompt.includes("stream_tokens")) {
      await this.demonstrateTokenStreaming(context);
    } else if (prompt.includes("stream_words")) {
      await this.demonstrateWordStreaming(context);
    } else if (prompt.includes("stream_sentences")) {
      await this.demonstrateSentenceStreaming(context);
    } else if (prompt.includes("stream_markdown")) {
      await this.demonstrateMarkdownStreaming(context);
    } else if (prompt.includes("compare_methods")) {
      await this.compareStreamingMethods(context);
    } else {
      // Default: simple response
      stdout("Use one of these commands to see streaming examples:\n");
      stdout("- stream_tokens: See character-by-character streaming\n");
      stdout("- stream_words: See word-by-word streaming\n");
      stdout("- stream_sentences: See sentence-by-sentence streaming\n");
      stdout("- stream_markdown: See AI-style markdown streaming\n");
      stdout("- compare_methods: Compare filtered vs unfiltered output\n");
    }

    return { success: true };
  }

  /**
   * Demonstrate character-by-character token streaming
   * Perfect for AI responses where every character matters
   */
  private async demonstrateTokenStreaming(context: ExecutionContext) {
    const { stdoutRaw } = context;

    const response =
      "Hello! I'm streaming each character as a separate token. Notice how spaces and punctuation are preserved.";

    // Stream each character as its own token
    for (const char of response) {
      stdoutRaw(char);
      await this.delay(50); // Simulate AI token generation delay
    }

    stdoutRaw("\n\n");
    stdoutRaw("🎯 This creates a smooth, typewriter-like effect!");
  }

  /**
   * Demonstrate word-by-word streaming with spaces
   */
  private async demonstrateWordStreaming(context: ExecutionContext) {
    const { stdoutRaw } = context;

    const words = [
      "Streaming",
      " ",
      "word",
      " ",
      "by",
      " ",
      "word",
      " ",
      "creates",
      " ",
      "natural",
      " ",
      "reading",
      " ",
      "flow",
      ".",
    ];

    for (const word of words) {
      stdoutRaw(word);
      await this.delay(200);
    }

    stdoutRaw("\n\n");
    stdoutRaw("Notice how spaces are preserved as separate tokens!");
  }

  /**
   * Demonstrate sentence-by-sentence streaming
   */
  private async demonstrateSentenceStreaming(context: ExecutionContext) {
    const { stdoutRaw } = context;

    const sentences = [
      "This is the first sentence.",
      " ",
      "Here comes the second one.",
      " ",
      "And finally, the third sentence completes our demo.",
    ];

    for (const sentence of sentences) {
      stdoutRaw(sentence);
      await this.delay(800);
    }

    stdoutRaw("\n\n");
    stdoutRaw("🚀 Perfect for streaming AI conversations!");
  }

  /**
   * Compare filtered vs unfiltered streaming methods
   */
  private async compareStreamingMethods(context: ExecutionContext) {
    const { stdout, stdoutRaw } = context;

    stdout("=== Comparing stdout vs stdoutRaw ===\n\n");

    // Test with regular stdout (filtered)
    stdout("Regular stdout method:\n");
    stdout("- This gets through: 'Hello'\n");
    stdout(""); // This gets filtered out
    stdout("   "); // This gets filtered out
    stdout("- This also gets through: 'World'\n");

    await this.delay(1000);

    stdout("\nRaw stdout method:\n");

    // Test with stdoutRaw (unfiltered)
    stdoutRaw("- This gets through: 'Hello'\n");
    stdoutRaw(""); // This does NOT get filtered out
    stdoutRaw("   "); // This does NOT get filtered out
    stdoutRaw("- This also gets through: 'World'\n");

    await this.delay(1000);

    stdout("\n=== Key Differences ===\n");
    stdout("✅ stdout: Filters empty/whitespace strings\n");
    stdout("✅ stdoutRaw: Preserves ALL tokens including empty/whitespace\n");
    stdout("🎯 Use stdoutRaw for AI streaming where every token matters!\n");
  }

  /**
   * Demonstrate streaming markdown display data updates
   * This simulates how AI responses build up incrementally
   */
  private async demonstrateMarkdownStreaming(context: ExecutionContext) {
    const { display, displayReplace } = context;

    // Create initial display output
    const outputId = crypto.randomUUID();
    display({
      "text/markdown": "# AI Response\n\n_Thinking..._",
      "text/plain": "AI Response\n\nThinking...",
    });

    await this.delay(1000);

    // Simulate streaming AI response building up
    const responseChunks = [
      "# AI Response\n\nHere's what I think",
      "# AI Response\n\nHere's what I think about your",
      "# AI Response\n\nHere's what I think about your question:",
      "# AI Response\n\nHere's what I think about your question:\n\n## Key Points",
      "# AI Response\n\nHere's what I think about your question:\n\n## Key Points\n\n1. First important",
      "# AI Response\n\nHere's what I think about your question:\n\n## Key Points\n\n1. First important point",
      "# AI Response\n\nHere's what I think about your question:\n\n## Key Points\n\n1. First important point\n2. Second consideration",
      "# AI Response\n\nHere's what I think about your question:\n\n## Key Points\n\n1. First important point\n2. Second consideration\n3. Final thoughts",
    ];

    // Stream each chunk with realistic delays
    for (const chunk of responseChunks) {
      await this.delay(400);
      displayReplace(outputId, {
        "text/markdown": chunk,
        "text/plain": chunk.replace(/[#*_]/g, ""),
      }, {
        streaming: true,
        timestamp: Date.now(),
      });
    }

    await this.delay(500);

    // Final complete response
    displayReplace(outputId, {
      "text/markdown": `# AI Response

Here's what I think about your question:

## Key Points

1. First important point
2. Second consideration
3. Final thoughts

## Summary

This demonstrates how AI responses can build up incrementally using \`displayReplace()\` for smooth streaming UX.

✨ **Perfect for AI chat interfaces!**`,
      "text/plain": "AI Response - Here's what I think about your question...",
    }, {
      streaming: false,
      complete: true,
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * AI Response Simulator - shows realistic AI streaming patterns
 */
class AIResponseSimulator {
  /**
   * Simulate streaming an AI response with realistic token patterns
   */
  static async simulateAIResponse(context: ExecutionContext, prompt: string) {
    const { stdoutRaw } = context;

    // Simulate AI thinking
    stdoutRaw("🤔 Thinking");
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      stdoutRaw(".");
    }
    stdoutRaw("\n\n");

    // Create initial display with thinking indicator
    const outputId = crypto.randomUUID();
    context.display({
      "text/markdown": "🤔 _Generating response..._",
      "text/plain": "Generating response...",
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Generate response based on prompt
    let response = "";
    if (prompt.includes("code")) {
      response =
        "Here's a Python function that demonstrates the concept:\n\n```python\ndef hello_world():\n    print('Hello, World!')\n    return True\n```\n\nThis function is simple but effective.";
    } else if (prompt.includes("explain")) {
      response =
        "Let me break this down step by step:\n\n1. First, we need to understand the basics\n2. Then, we can dive into the details\n3. Finally, we'll see practical examples\n\nDoes this help clarify things?";
    } else {
      response = "I understand you're asking about: " + prompt +
        "\n\nThis is a complex topic that involves several key concepts. Let me explain each one clearly.";
    }

    // Stream the response by building up the markdown content
    let currentContent = "";
    for (const char of response) {
      currentContent += char;

      // Update the display with growing content
      context.displayReplace(outputId, {
        "text/markdown": currentContent,
        "text/plain": currentContent,
      }, {
        streaming: true,
        "anode/ai_response": true,
      });

      // Variable delay to simulate realistic AI generation
      const delay = char === " " ? 30 : Math.random() * 100 + 20;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // Final update to mark as complete
    context.displayReplace(outputId, {
      "text/markdown": currentContent + "\n\n✨ _Response complete!_",
      "text/plain": currentContent + "\n\nResponse complete!",
    }, {
      streaming: false,
      complete: true,
      "anode/ai_response": true,
    });
  }
}

// Main execution
if (import.meta.main) {
  const example = new AIStreamingExample();

  // Handle graceful shutdown
  const shutdownHandler = () => {
    console.log("\n🛑 Shutting down AI streaming example...");
    example.shutdown().then(() => {
      console.log("✅ Shutdown complete");
      Deno.exit(0);
    });
  };

  Deno.addSignalListener("SIGINT", shutdownHandler);
  Deno.addSignalListener("SIGTERM", shutdownHandler);

  // Start the example
  example.start().catch((error) => {
    console.error("❌ Error starting AI streaming example:", error);
    Deno.exit(1);
  });
}

export { AIResponseSimulator, AIStreamingExample };

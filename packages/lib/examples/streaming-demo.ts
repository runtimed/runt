// Streaming Demo Agent
//
// This demonstrates the unified output system's streaming capabilities by simulating
// real-world streaming scenarios using ExecutionContext methods. Watch how outputs
// are grouped and appended in real-time.

import { createRuntimeConfig, RuntimeAgent } from "@runt/lib";
import type { ExecutionContext } from "@runt/lib";
import { events, tables } from "@runt/schema";

class StreamingDemoAgent {
  private agent: RuntimeAgent;

  constructor() {
    let config;
    try {
      config = createRuntimeConfig(Deno.args, {
        runtimeType: "streaming-demo",
        capabilities: {
          canExecuteCode: true,
          canExecuteSql: false,
          canExecuteAi: false,
        },
      });
    } catch (error) {
      console.error("❌ Configuration Error:");
      console.error(error instanceof Error ? error.message : String(error));
      console.error("\nExample usage:");
      console.error(
        "  deno run --allow-all --env-file=.env streaming-demo.ts --notebook streaming-demo --auth-token your-token",
      );
      Deno.exit(1);
    }

    this.agent = new RuntimeAgent(config, config.capabilities);
    this.agent.onExecution(this.executeCode.bind(this));
  }

  async start() {
    const result = await this.agent.start();

    // Auto-create help cell if notebook is empty
    this.createHelpCellIfEmpty();

    return result;
  }

  async shutdown() {
    return await this.agent.shutdown();
  }

  async keepAlive() {
    return await this.agent.keepAlive();
  }

  private createHelpCellIfEmpty() {
    try {
      // Check if there are any existing cells using LiveStore query
      const cells = this.agent.liveStore.query(
        tables.cells.select(),
      );

      if (cells.length === 0) {
        console.log("📝 Creating initial help cell for empty notebook...");

        // Create a cell with help command
        const cellId = crypto.randomUUID();
        this.agent.liveStore.commit(events.cellCreated({
          id: cellId,
          cellType: "code",
          position: 0,
          createdBy: "streaming-demo-runtime",
        }));

        // Update the cell with source content
        this.agent.liveStore.commit(events.cellSourceChanged({
          id: cellId,
          source: "help",
          modifiedBy: "streaming-demo-runtime",
        }));

        // Queue it for execution
        const queueId = crypto.randomUUID();
        this.agent.liveStore.commit(events.executionRequested({
          queueId: queueId,
          cellId: cellId,
          executionCount: 1,
          requestedBy: "streaming-demo-runtime",
        }));
      }
    } catch (error) {
      console.warn("Failed to create help cell:", error);
    }
  }

  private async executeCode(context: ExecutionContext) {
    const {
      cell,
      stdout,
      stderr,
      display,
      result,
      clear,
      markdown,
      appendMarkdown,
    } = context;
    const code = cell.source?.trim() || "";

    try {
      // Demo 1: Streaming stdout (should group into single output)
      if (code.includes("demo_stdout_stream")) {
        console.log("🚀 Demo: Streaming stdout output...");

        stdout("Starting stdout stream demo...\n");
        await this.delay(500);

        for (let i = 1; i <= 5; i++) {
          stdout(
            `[${new Date().toLocaleTimeString()}] Processing chunk ${i}/5...\n`,
          );
          await this.delay(400);
        }

        stdout("✅ Stdout streaming complete!\n");

        return { success: true };
      }

      // Demo 2: Mixed stdout/stderr (should create separate output blocks)
      if (code.includes("demo_mixed_streams")) {
        console.log("🚀 Demo: Mixed stdout/stderr streams...");

        stdout("STDOUT: Starting mixed stream demo\n");
        await this.delay(300);

        stderr("STDERR: Warning - this is an error stream\n");
        await this.delay(300);

        stdout("STDOUT: Back to stdout stream\n");
        stdout("STDOUT: More stdout content here\n");
        await this.delay(300);

        stderr("STDERR: Another error message\n");
        await this.delay(300);

        stdout("STDOUT: Final stdout message\n");

        return { success: true };
      }

      // Demo 3: Long running process with progress
      if (code.includes("demo_long_process")) {
        console.log("🚀 Demo: Long running process with streaming output...");

        stdout("🔄 Starting long computation...\n");
        await this.delay(200);

        for (let step = 1; step <= 10; step++) {
          stdout(`Step ${step}/10: `);
          await this.delay(100);

          // Simulate work with dots
          for (let dot = 0; dot < 3; dot++) {
            stdout(".");
            await this.delay(150);
          }

          stdout(` ✓ Complete\n`);

          // Show intermediate results
          if (step === 5) {
            display({
              "text/markdown":
                "## Halfway Progress\n\n50% complete! Intermediate results look good.",
              "text/plain": "Halfway progress: 50% complete",
            });
          }

          await this.delay(200);
        }

        stdout("\n🎉 Process completed successfully!\n");

        result({
          "text/plain": "Computation finished",
          "application/json": JSON.stringify({
            status: "success",
            steps_completed: 10,
            duration: "~6 seconds",
          }),
        });

        return { success: true };
      }

      // Demo 4: Simulated AI streaming response (using proper markdown streaming)
      if (code.includes("demo_ai_stream")) {
        console.log("🚀 Demo: AI-style streaming response...");

        // Start with initial markdown output and get the actual output ID
        const markdownId = markdown("🤖 AI Assistant is thinking");
        await this.delay(300);

        // Simulate typing dots using markdown append
        for (let i = 0; i < 3; i++) {
          appendMarkdown(markdownId, ".");
          await this.delay(100);
        }
        appendMarkdown(markdownId, "\n\n");

        // Stream the response content token by token to simulate real AI streaming
        const fullResponse =
          `I'll help you understand streaming outputs in the unified system.

The new system uses granular events:
- \`terminalOutputAdded\` for initial output
- \`terminalOutputAppended\` for streaming content
- \`markdownOutputAdded\` for rich content
- \`markdownOutputAppended\` for streaming markdown

## Benefits include:
1. **Type Safety**: Each event has a precise schema
2. **Performance**: Better SQL operations with flattened data
3. **Streaming**: Real-time append operations
4. **Grouping**: Consecutive outputs merge naturally

This creates a much better user experience! ✨`;

        // Split into token-like chunks for realistic streaming
        const tokens = this.tokenizeText(fullResponse);

        for (const token of tokens) {
          appendMarkdown(markdownId, token);
          // Vary the delay to simulate realistic AI token generation
          const delay = token.includes("\n") ? 50 : Math.random() * 30 + 20;
          await this.delay(delay);
        }

        // Final status message
        appendMarkdown(
          markdownId,
          "\n---\n\n*Streaming markdown demonstration complete!*",
        );

        return { success: true };
      }

      // Demo 5: Clear output during streaming
      if (code.includes("demo_clear_stream")) {
        console.log("🚀 Demo: Clear output during streaming...");

        stdout("This content will be cleared...\n");
        stdout("Adding more content that will disappear...\n");
        await this.delay(1000);

        stdout("One more line before clearing...\n");
        await this.delay(500);

        clear(true); // wait=true for smooth replacement

        await this.delay(300);

        stdout("🧹 Content cleared! This is the new output.\n");
        await this.delay(200);

        stdout("Streaming continues after clear...\n");

        return { success: true };
      }

      // Demo 6: AI-style streaming markdown (enhanced version)
      if (code.includes("demo_ai_markdown")) {
        console.log("🚀 Demo: Enhanced AI-style streaming markdown...");

        // Start with initial markdown output
        const markdownId = markdown(
          "🤖 **AI Assistant** is analyzing your request",
        );
        await this.delay(300);

        // Simulate typing dots
        for (let i = 0; i < 3; i++) {
          appendMarkdown(markdownId, ".");
          await this.delay(150);
        }
        appendMarkdown(markdownId, "\n\n");

        // Stream realistic AI response content
        const aiResponse =
          `Based on your request, I'll help you understand the streaming capabilities.

## Key Features

The **unified output system** provides several streaming mechanisms:

### 1. Terminal Streaming
- \`stdout\` and \`stderr\` streams group automatically
- Real-time append with \`appendTerminal\`
- Separate streams maintain clear boundaries

### 2. Markdown Streaming
- \`markdown()\` creates initial content
- \`appendMarkdown()\` streams additional content
- Perfect for AI responses and documentation

### 3. Rich Media Support
- Display plots, tables, and interactive content
- Update existing displays with \`updateDisplay\`
- Full multimedia capabilities

## Performance Benefits

1. **Granular Events**: Each append is a discrete event
2. **Type Safety**: Precise schemas for all operations
3. **Real-time Updates**: Instant user feedback
4. **Efficient Storage**: Flattened data structure

This creates an **excellent developer experience** for building interactive applications! 🚀

*Would you like me to demonstrate any specific streaming feature?*`;

        // Stream token by token with realistic delays
        const tokens = this.tokenizeText(aiResponse);
        for (const token of tokens) {
          appendMarkdown(markdownId, token);

          // Realistic AI streaming delays
          let delay = 30; // Base delay

          if (token.includes("\n")) delay = 100; // Pause at line breaks
          else if (token.includes("*")) delay = 80; // Pause at emphasis
          else if (token.includes(".")) delay = 200; // Pause at sentences
          else if (token.includes(",")) delay = 50; // Brief pause at commas
          else if (Math.random() < 0.1) delay = 80; // Random thinking pauses

          await this.delay(delay);
        }

        // Final completion indicator
        appendMarkdown(
          markdownId,
          "\n\n---\n*✨ Streaming complete! Try other demos to see more features.*",
        );

        return { success: true };
      }

      // Demo 7: Performance test with rapid streaming
      if (code.includes("demo_performance")) {
        console.log("🚀 Demo: Performance test with rapid streaming...");

        stdout("⚡ Starting rapid output test...\n");
        await this.delay(200);

        const startTime = Date.now();

        // Rapid stdout streaming
        for (let i = 0; i < 20; i++) {
          stdout(`Item ${i + 1} `);
          await this.delay(50); // Very fast

          if ((i + 1) % 5 === 0) {
            stdout("|\n");
          }
        }

        const duration = Date.now() - startTime;
        stdout(`\n⏱️  Completed 20 rapid outputs in ${duration}ms\n`);

        return { success: true };
      }

      // Demo 8: Error handling with streaming
      if (code.includes("demo_error_stream")) {
        console.log("🚀 Demo: Error during streaming...");

        stdout("Starting process that will encounter an error...\n");
        await this.delay(300);

        stdout("Step 1: Initializing...\n");
        await this.delay(200);

        stdout("Step 2: Processing data...\n");
        await this.delay(200);

        stderr("WARNING: Anomaly detected in data\n");
        await this.delay(300);

        stdout("Step 3: Attempting recovery...\n");
        await this.delay(500);

        // Simulate error
        throw new Error("Simulated error during streaming process");
      }

      // Help/Default
      if (code === "" || code.includes("help")) {
        markdown(`# 🌊 Streaming Demo Commands

Try these demos to see the unified output system in action:

## Basic Streaming
- \`demo_stdout_stream\` - Watch stdout content group together
- \`demo_mixed_streams\` - See stdout/stderr stay separate

## Advanced Features
- \`demo_long_process\` - Long running task with progress
- \`demo_ai_stream\` - **AI-style markdown streaming** ✨
- \`demo_ai_markdown\` - **Enhanced AI markdown streaming** 🚀
- \`demo_clear_stream\` - Clear output during streaming
- \`demo_performance\` - Rapid output performance test
- \`demo_error_stream\` - Error handling during streaming

Each demo shows different aspects of how the new granular events work!`);

        return { success: true };
      }

      // Unknown command
      stdout(`❓ Unknown demo: ${code}\n`);
      stdout("💡 Try 'help' to see available demos\n");

      return { success: true };
    } catch (err) {
      // Error handling
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      stderr(`💥 Error: ${errorMsg}\n`);

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private tokenizeText(text: string): string[] {
    // Split text into token-like chunks for realistic AI streaming
    const tokens: string[] = [];
    const words = text.split(/(\s+)/); // Keep whitespace

    for (const word of words) {
      if (word.length <= 4) {
        // Short words/spaces as single tokens
        tokens.push(word);
      } else {
        // Break longer words into smaller chunks
        for (let i = 0; i < word.length; i += 3) {
          tokens.push(word.slice(i, i + 3));
        }
      }
    }

    return tokens;
  }
}

async function runStreamingDemo() {
  const demo = new StreamingDemoAgent();

  try {
    console.log("🌊 Starting Streaming Demo Agent...");
    await demo.start();

    console.log("✅ Demo agent ready!");
    console.log("");
    console.log("📋 Available streaming demos:");
    console.log("   demo_stdout_stream   - Basic stdout grouping");
    console.log("   demo_mixed_streams   - stdout/stderr separation");
    console.log("   demo_long_process    - Progress streaming");
    console.log("   demo_ai_stream       - AI-style markdown streaming");
    console.log("   demo_ai_markdown     - Enhanced AI markdown streaming");
    console.log("   demo_clear_stream    - Clear during streaming");
    console.log("   demo_performance     - Rapid output test");
    console.log("   demo_error_stream    - Error handling");
    console.log("");
    console.log("🎯 Each demo shows different unified output system features");

    await demo.keepAlive();
  } catch (error) {
    console.error("❌ Demo failed:", error);
  } finally {
    await demo.shutdown();
  }
}

if (import.meta.main) {
  console.log("🌊 Unified Output System - Streaming Demo");
  try {
    await runStreamingDemo();
  } catch (error) {
    console.error("❌ Failed to start streaming demo:", error);
    Deno.exit(1);
  }
}

export { runStreamingDemo, StreamingDemoAgent };

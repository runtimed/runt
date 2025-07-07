// Streaming Demo Agent
//
// This demonstrates the unified output system's streaming capabilities by simulating
// real-world streaming scenarios using ExecutionContext methods. Watch how outputs
// are grouped and appended in real-time.

import { createRuntimeConfig, RuntimeAgent } from "@runt/lib";
import type { ExecutionContext } from "@runt/lib";

class StreamingDemoAgent {
  private agent: RuntimeAgent;

  constructor() {
    let config;
    try {
      config = createRuntimeConfig(Deno.args, {
        kernelType: "streaming-demo",
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
    return await this.agent.start();
  }

  async shutdown() {
    return await this.agent.shutdown();
  }

  async keepAlive() {
    return await this.agent.keepAlive();
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
          await this.delay(400);
        }
        appendMarkdown(markdownId, "\n\n");

        // Stream the response content by content using markdown append
        const responseLines = [
          "I'll help you understand streaming outputs in the unified system.\n\n",
          "The new system uses granular events:\n",
          "- `terminalOutputAdded` for initial output\n",
          "- `terminalOutputAppended` for streaming content\n",
          "- `markdownOutputAdded` for rich content\n",
          "- `markdownOutputAppended` for streaming markdown\n\n",
          "## Benefits include:\n",
          "1. **Type Safety**: Each event has a precise schema\n",
          "2. **Performance**: Better SQL operations with flattened data\n",
          "3. **Streaming**: Real-time append operations\n",
          "4. **Grouping**: Consecutive outputs merge naturally\n\n",
          "This creates a much better user experience! ✨\n",
        ];

        for (const line of responseLines) {
          appendMarkdown(markdownId, line);
          await this.delay(300);
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

      // Demo 6: Performance test with rapid streaming
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

      // Demo 7: Error handling with streaming
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

// Enhanced Output Example

import { createRuntimeConfig, RuntimeAgent } from "@runt/lib";
import type { ExecutionContext } from "@runt/lib";

// Python-like runtime with streaming output support
class ExamplePythonRuntime {
  private agent: RuntimeAgent;

  constructor() {
    // Create config from CLI args and environment variables
    let config;
    try {
      config = createRuntimeConfig(Deno.args, {
        runtimeType: "enhanced-python",
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
        "  deno run --allow-all --env-file=.env enhanced-output-example.ts --notebook my-notebook --auth-token your-token",
      );
      console.error("\nOr set environment variables in .env:");
      console.error("  NOTEBOOK_ID=my-notebook");
      console.error("  AUTH_TOKEN=your-token");
      Deno.exit(1);
    }

    this.agent = new RuntimeAgent(config, config.capabilities);

    // Register execution handler with enhanced output support
    this.agent.onExecution(this.executeCode.bind(this));
  }

  async start() {
    await this.agent.start();
  }

  async shutdown() {
    return await this.agent.shutdown();
  }

  async keepAlive() {
    return await this.agent.keepAlive();
  }

  // Enhanced execution handler demonstrating streaming outputs
  private async executeCode(context: ExecutionContext) {
    const {
      cell,
      stdout,
      stderr,
      display,
      result,
      error,
      clear,
    } = context;
    const code = cell.source || "";

    try {
      // Example 1: Simple print statement with streaming stdout
      if (code.includes("print(")) {
        // Simulate real-time stdout emission
        stdout("Starting execution...\n");
        await this.delay(100);

        stdout(`Executing: ${code}\n`);
        await this.delay(200);

        // Extract and execute print statements
        const printMatch = code.match(/print\((.*?)\)/);
        if (printMatch) {
          const output = printMatch[1].replace(/['"]/g, "");
          stdout(`${output}\n`);
        }

        return { success: true };
      }

      // Example 2: Matplotlib-style plotting with rich display
      if (code.includes("plt.") || code.includes("matplotlib")) {
        stdout("Generating plot...\n");
        await this.delay(500);

        // Simulate SVG plot generation
        const svgPlot =
          `<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#f8f9fa" stroke="#dee2e6"/>
  <line x1="50" y1="250" x2="350" y2="50" stroke="#007bff" stroke-width="2"/>
  <text x="200" y="280" text-anchor="middle" font-size="12">Sample Plot</text>
</svg>`;

        // Emit rich display output
        display({
          "image/svg+xml": svgPlot,
          "text/plain": "Plot generated successfully",
        }, {
          "plot_type": "line",
          "generated_by": "example-runtime",
        });

        return { success: true };
      }

      // Example 3: DataFrame-style output with HTML table
      if (code.includes("df.head()") || code.includes("DataFrame")) {
        stdout("Displaying DataFrame...\n");

        const htmlTable = `<table border="1" class="dataframe">
  <thead>
    <tr style="text-align: right;">
      <th></th>
      <th>Column A</th>
      <th>Column B</th>
      <th>Column C</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th>0</th>
      <td>1</td>
      <td>4.5</td>
      <td>foo</td>
    </tr>
    <tr>
      <th>1</th>
      <td>2</td>
      <td>7.2</td>
      <td>bar</td>
    </tr>
    <tr>
      <th>2</th>
      <td>3</td>
      <td>1.8</td>
      <td>baz</td>
    </tr>
  </tbody>
</table>`;

        // Emit both HTML and plain text representations
        result({
          "text/html": htmlTable,
          "text/plain":
            "   Column A  Column B Column C\n0         1       4.5      foo\n1         2       7.2      bar\n2         3       1.8      baz",
        });

        return { success: true };
      }

      // Example 4: Multi-step execution with progress updates
      if (code.includes("long_computation()")) {
        stdout("Starting long computation...\n");

        for (let i = 1; i <= 5; i++) {
          await this.delay(300);
          stdout(`Step ${i}/5 completed\n`);

          // Emit intermediate results
          if (i === 3) {
            display({
              "text/markdown":
                `## Intermediate Result\n\nCompleted ${i} steps so far...`,
              "text/plain": `Intermediate result: ${i} steps completed`,
            });
          }
        }

        // Final result
        result({
          "text/plain": "Computation completed successfully!",
          "application/json": JSON.stringify({
            status: "success",
            steps_completed: 5,
            execution_time: "1.5s",
          }),
        });

        return { success: true };
      }

      // Example 5: Error handling with rich traceback
      if (code.includes("raise") || code.includes("error")) {
        stderr("Error detected in code\n");

        // Emit structured error
        error(
          "PythonError",
          "This is an example error for demonstration",
          [
            "Traceback (most recent call last):",
            '  File "<cell>", line 1, in <module>',
            "    raise ValueError('This is an example error')",
            "ValueError: This is an example error for demonstration",
          ],
        );

        return { success: false, error: "Example error occurred" };
      }

      // Example 6: Mixed output types
      if (code.includes("mixed_output")) {
        // Clear any previous outputs first
        clear();

        // Stream some initial output
        stdout("Generating mixed output types...\n");
        await this.delay(200);

        // Emit a warning to stderr
        stderr("Warning: This is just an example\n");
        await this.delay(100);

        // Display some rich content
        display({
          "text/markdown":
            "## Mixed Output Example\n\nThis demonstrates multiple output types:",
          "text/html":
            "<h2>Mixed Output Example</h2><p>This demonstrates multiple output types:</p>",
        });

        await this.delay(200);

        // Final execution result
        result({
          "text/plain": "All output types demonstrated successfully",
          "application/json": JSON.stringify({
            outputs_generated: [
              "stdout",
              "stderr",
              "display_data",
              "execute_result",
            ],
            timestamp: new Date().toISOString(),
          }),
        });

        return { success: true };
      }

      // Default: Simple echo execution
      stdout(`Echo: ${code}\n`);
      return {
        success: true,
        data: { "text/plain": code },
        outputType: "execute_result" as const,
      };
    } catch (err) {
      // Handle unexpected errors
      error(
        "RuntimeError",
        err instanceof Error ? err.message : "Unknown error",
        [err instanceof Error ? err.stack || err.message : String(err)],
      );

      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Usage example
async function runExample() {
  const runtime = new ExamplePythonRuntime();

  try {
    console.log("🚀 Starting enhanced output example runtime...");
    await runtime.start();

    console.log("✅ Runtime started successfully!");
    console.log("📝 Try executing cells with these code examples:");
    console.log("   - print('Hello, World!')");
    console.log("   - plt.plot([1, 2, 3], [1, 4, 9])");
    console.log("   - df.head()");
    console.log("   - long_computation()");
    console.log("   - raise ValueError('Test error')");
    console.log("   - mixed_output()");

    // Keep running until shutdown
    await runtime.keepAlive();
  } catch (error) {
    console.error("❌ Failed to start runtime:", error);
  } finally {
    await runtime.shutdown();
  }
}

// Demonstration class for different output approaches
class ComparisonExample {
  // Basic approach: single result output
  private simpleExecutionHandler(context: ExecutionContext) {
    const code = context.cell.source || "";

    return {
      success: true,
      data: { "text/plain": `Result: ${code}` },
      outputType: "execute_result" as const,
    };
  }

  // Enhanced approach: streaming outputs
  private async richExecutionHandler(context: ExecutionContext) {
    const { cell, stdout, display, result } = context;
    const code = cell.source || "";

    // Emit multiple outputs in real-time
    stdout("Starting execution...\n");
    stdout("Processing input...\n");
    await new Promise((resolve) => setTimeout(resolve, 100));

    display({
      "text/markdown":
        "## Processing Results\n\nIntermediate output during execution",
    });

    stdout("Finalizing results...\n");

    result({
      "text/plain": `Final result: ${code}`,
      "application/json": JSON.stringify({ processed: true, input: code }),
    });

    return { success: true };
  }
}

if (import.meta.main) {
  console.log("🎨 Enhanced Output Example");
  console.log("🚀 Starting Python runtime with rich output support...");
  try {
    await runExample();
  } catch (error) {
    console.error(
      "❌ Example failed:",
      error instanceof Error ? error.message : String(error),
    );
    Deno.exit(1);
  }
}

export { ComparisonExample, ExamplePythonRuntime, runExample };

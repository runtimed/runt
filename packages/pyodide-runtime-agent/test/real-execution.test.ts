// Real Pyodide execution tests with actual Python code execution

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "jsr:@std/assert";
import { PyodideRuntimeAgent } from "../src/pyodide-agent.ts";
import type { ExecutionContext, ExecutionResult } from "@runt/lib/types";
import type { RichOutputData } from "@runt/schema";

// Create test agent with minimal packages for speed
function createTestAgent(packages?: string[]): PyodideRuntimeAgent {
  const validArgs = [
    "--kernel-id",
    "test-execution-kernel",
    "--notebook",
    "test-notebook",
    "--auth-token",
    "test-token",
    "--sync-url",
    "ws://localhost:8787",
  ];

  return new PyodideRuntimeAgent(validArgs, packages ? { packages } : {});
}

// Simple output capture for testing
interface CapturedOutput {
  type:
    | "stdout"
    | "stderr"
    | "result"
    | "display"
    | "error"
    | "clear"
    | "appendTerminal"
    | "markdown"
    | "appendMarkdown";
  data: unknown;
  metadata?: Record<string, unknown> | undefined;
}

// Create a minimal execution context that captures outputs
function createTestExecutionContext(code: string): {
  context: ExecutionContext;
  outputs: CapturedOutput[];
  abortController: AbortController;
} {
  const outputs: CapturedOutput[] = [];
  const abortController = new AbortController();

  // Create minimal context that satisfies the ExecutionContext interface
  const context: ExecutionContext = {
    cell: {
      id: "test-cell-" + Math.random().toString(36).slice(2),
      cellType: "code",
      source: code,
      position: 0,
      executionCount: 1,
      executionState: "running",
      assignedKernelSession: null,
      lastExecutionDurationMs: null,
      sqlConnectionId: null,
      sqlResultData: null,
      aiProvider: null,
      aiModel: null,
      aiSettings: null,
      sourceVisible: true,
      outputVisible: true,
      aiContextVisible: true,
      createdBy: "test-user",
    },
    queueEntry: {
      id: "test-queue-" + Math.random().toString(36).slice(2),
      cellId: "test-cell-" + Math.random().toString(36).slice(2),
      executionCount: 1,
      requestedBy: "test-user",
      status: "executing" as const,
      assignedKernelSession: "test-session",
      priority: 0,
      retryCount: 0,
      maxRetries: 3,
      startedAt: new Date(),
      completedAt: null,
      executionDurationMs: null,
    },
    store: {} as ExecutionContext["store"], // Minimal mock - not used in these tests
    sessionId: "test-session",
    kernelId: "pyodide-test-kernel",
    abortSignal: abortController.signal,
    checkCancellation: () => {
      if (abortController.signal.aborted) {
        throw new Error("Execution was cancelled");
      }
    },
    stdout: (text: string) => outputs.push({ type: "stdout", data: text }),
    stderr: (text: string) => outputs.push({ type: "stderr", data: text }),
    result: (data: RichOutputData, metadata?: Record<string, unknown>) =>
      outputs.push({ type: "result", data, metadata: metadata || undefined }),
    display: (
      data: RichOutputData,
      metadata?: Record<string, unknown>,
    ) =>
      outputs.push({ type: "display", data, metadata: metadata || undefined }),
    updateDisplay: (
      _displayId: string,
      data: RichOutputData,
      metadata?: Record<string, unknown>,
    ) =>
      outputs.push({ type: "display", data, metadata: metadata || undefined }),
    error: (ename: string, evalue: string, traceback: string[]) =>
      outputs.push({ type: "error", data: { ename, evalue, traceback } }),
    clear: () => outputs.push({ type: "clear", data: null }),
    appendTerminal: (outputId: string, text: string) =>
      outputs.push({ type: "appendTerminal", data: { outputId, text } }),
    markdown: (content: string, metadata?: Record<string, unknown>) => {
      outputs.push({ type: "markdown", data: { content, metadata } });
      return "mock-markdown-id";
    },
    appendMarkdown: (outputId: string, content: string) =>
      outputs.push({ type: "appendMarkdown", data: { outputId, content } }),
  };

  return { context, outputs, abortController };
}

Deno.test("Custom package configuration", () => {
  const customPackages = ["micropip", "ipython", "matplotlib", "numpy"];
  const agent = createTestAgent(customPackages);

  assertExists(agent);
  assertEquals(agent.config.kernelType, "python3-pyodide");
});

Deno.test("Agent initialization with custom packages", async () => {
  const agent = createTestAgent(["micropip", "ipython", "matplotlib"]);
  assertExists(agent);
  assertEquals(agent.config.kernelType, "python3-pyodide");

  await agent.shutdown();
});

// Real Pyodide execution tests
Deno.test({
  name: "Real Pyodide execution with essential packages",
  sanitizeOps: false,
  sanitizeResources: false,
}, async (t) => {
  let agent: PyodideRuntimeAgent;

  await t.step("initialize agent", async () => {
    agent = createTestAgent(); // Uses default essential packages
    await agent.start();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  await t.step("basic Python print", async () => {
    const { context, outputs } = createTestExecutionContext(
      "print('Hello from Pyodide!')",
    );

    const result: ExecutionResult = await agent.executeCell(context);
    assertEquals(result.success, true);

    const stdoutOutputs = outputs.filter((o) => o.type === "stdout");
    assertEquals(stdoutOutputs.length > 0, true);

    const stdoutText = stdoutOutputs.map((o) => o.data).join("");
    assertStringIncludes(stdoutText, "Hello from Pyodide!");
  });

  await t.step("simple arithmetic", async () => {
    const { context, outputs } = createTestExecutionContext("2 + 2");

    const result: ExecutionResult = await agent.executeCell(context);
    assertEquals(result.success, true);

    const resultOutputs = outputs.filter((o) => o.type === "result");
    assertEquals(resultOutputs.length > 0, true);
  });

  await t.step("Python variables and expressions", async () => {
    const { context, outputs } = createTestExecutionContext(`
x = 42
y = "test"
print(f"x = {x}, y = {y}")
x + len(y)
    `);

    const result: ExecutionResult = await agent.executeCell(context);
    assertEquals(result.success, true);

    const stdoutOutputs = outputs.filter((o) => o.type === "stdout");
    const resultOutputs = outputs.filter((o) => o.type === "result");

    assertEquals(stdoutOutputs.length > 0, true);
    assertEquals(resultOutputs.length > 0, true);

    const stdoutText = stdoutOutputs.map((o) => o.data).join("");
    assertStringIncludes(stdoutText, "x = 42, y = test");
  });

  await t.step("multiple print statements", async () => {
    const { context, outputs } = createTestExecutionContext(`
print('first line')
print('second line')
    `);

    const result: ExecutionResult = await agent.executeCell(context);
    assertEquals(result.success, true);

    const stdoutOutputs = outputs.filter((o) => o.type === "stdout");
    assertEquals(stdoutOutputs.length > 0, true);

    const stdoutText = stdoutOutputs.map((o) => o.data).join("");
    assertStringIncludes(stdoutText, "first line");
    assertStringIncludes(stdoutText, "second line");
  });

  await t.step("Python error handling", async () => {
    const { context, outputs } = createTestExecutionContext(
      "raise ValueError('test error message')",
    );

    const result: ExecutionResult = await agent.executeCell(context);
    assertEquals(result.success, true); // Execution succeeds, error is captured

    const errorOutputs = outputs.filter((o) => o.type === "error");
    assertEquals(errorOutputs.length > 0, true);

    const errorData = errorOutputs[0]?.data as {
      ename: string;
      evalue: string;
      traceback: string[];
    };
    assertEquals(errorData.ename, "ValueError");
    assertStringIncludes(errorData.evalue, "test error message");
  });

  await t.step("execution cancellation", async () => {
    const { context, abortController } = createTestExecutionContext(`
for i in range(3):
    print(f"Step {i}")
print("Should not reach here")
    `);

    // Cancel before execution
    abortController.abort();

    const result: ExecutionResult = await agent.executeCell(context);
    assertEquals(result.success, false);
    assertStringIncludes(result.error || "", "cancelled");
  });

  await t.step("micropip availability", async () => {
    const { context, outputs } = createTestExecutionContext(`
import micropip
print("micropip version:", micropip.__version__)
    `);

    const result: ExecutionResult = await agent.executeCell(context);
    assertEquals(result.success, true);

    const stdoutOutputs = outputs.filter((o) => o.type === "stdout");
    const stdoutText = stdoutOutputs.map((o) => o.data).join("");
    assertStringIncludes(stdoutText, "micropip version:");
  });

  await t.step("IPython display system", async () => {
    const { context, outputs } = createTestExecutionContext(`
from IPython.display import HTML, display
display(HTML("<b>Bold text from IPython</b>"))
    `);

    const result: ExecutionResult = await agent.executeCell(context);
    assertEquals(result.success, true);

    const displayOutputs = outputs.filter((o) => o.type === "display");
    assertEquals(displayOutputs.length > 0, true);

    // Check for HTML content in display data
    const hasHtmlDisplay = displayOutputs.some((output) => {
      const data = output.data as Record<string, unknown>;
      return data && typeof data["text/html"] === "string" &&
        (data["text/html"] as string).includes("Bold text");
    });
    assertEquals(hasHtmlDisplay, true);
  });

  await t.step("cleanup", async () => {
    await agent.shutdown();
  });
});

// Real Pyodide execution tests with actual Python code execution

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "jsr:@std/assert";
import { PyodideRuntimeAgent } from "../src/pyodide-agent.ts";
import { RichOutputData } from "@runt/schema";
// Tests now use custom package lists instead of getTestPackages

// Mock types for testing
interface MockStore {
  commit?: () => void; // Mock store with basic structure
}

interface MockQueueEntry {
  id: string;
  cellId: string;
}

// Create test agent with minimal packages for speed
// Helper to create test agent with custom package loading
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

  // Use custom package list or default to essential packages
  return new PyodideRuntimeAgent(validArgs, packages ? { packages } : {});
}

// Test execution context that captures outputs
interface CapturedOutput {
  type: "stdout" | "stderr" | "result" | "display" | "error" | "clear";
  data: unknown;
  metadata?: Record<string, unknown> | undefined;
}

// Mock execution context type for testing
interface ExecutionContextLike {
  cell: {
    id: string;
    cellType: "code";
    source: string;
    position: number;
    executionCount: number;
    executionState: "running";
    assignedKernelSession: null;
    lastExecutionDurationMs: null;
    sqlConnectionId: null;
    sqlResultData: null;
    aiProvider: null;
    aiModel: null;
    aiSettings: null;
    sourceVisible: boolean;
    outputVisible: boolean;
    aiContextVisible: boolean;
    createdBy: string;
  };
  queueEntry: MockQueueEntry;
  store: MockStore;
  sessionId: string;
  kernelId: string;
  abortSignal: AbortSignal;
  checkCancellation: () => void;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  result: (data: unknown, metadata?: Record<string, unknown>) => void;
  display: (data: unknown, metadata?: Record<string, unknown>) => void;
  updateDisplay: (
    displayId: string,
    data: RichOutputData,
    metadata?: Record<string, unknown>,
  ) => void;
  error: (ename: string, evalue: string, traceback: string[]) => void;
  clear: () => void;
}

function createExecutionContext(code: string): {
  context: ExecutionContextLike;
  outputs: CapturedOutput[];
  abortController: AbortController;
} {
  const outputs: CapturedOutput[] = [];
  const abortController = new AbortController();

  const context = {
    cell: {
      id: "test-cell-" + Math.random().toString(36).slice(2),
      cellType: "code" as const,
      source: code,
      position: 0,
      executionCount: 1,
      executionState: "running" as const,
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
    },
    store: {} as MockStore,
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
    result: (data: unknown, metadata?: Record<string, unknown>) =>
      outputs.push({ type: "result", data, metadata: metadata || undefined }),
    display: (data: unknown, metadata?: Record<string, unknown>) =>
      outputs.push({ type: "display", data, metadata: metadata || undefined }),
    updateDisplay: (
      displayId: string,
      data: unknown,
      metadata?: Record<string, unknown>,
    ) =>
      outputs.push({ type: "display", data, metadata: metadata || undefined }),
    error: (ename: string, evalue: string, traceback: string[]) =>
      outputs.push({ type: "error", data: { ename, evalue, traceback } }),
    clear: () => outputs.push({ type: "clear", data: null }),
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

  // Should shut down cleanly
  await agent.shutdown();
});

// This test actually loads Pyodide - it's slow but tests real functionality
Deno.test({
  name: "Real Pyodide execution with essential packages",
  sanitizeOps: false,
  sanitizeResources: false,
}, async (t) => {
  let agent: PyodideRuntimeAgent;

  await t.step("initialize agent with essential packages", async () => {
    agent = createTestAgent(); // Uses default essential packages
    assertExists(agent);

    // Start the agent - this will load Pyodide with minimal packages
    await agent.start();

    // Give it a moment to fully initialize
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  await t.step("test basic Python print", async () => {
    const { context, outputs } = createExecutionContext(
      "print('Hello from Pyodide!')",
    );

    // Execute through the agent
    const result = await agent.executeCell(context as unknown as any);

    assertEquals(typeof result, "object");
    assertEquals(result.success, true);

    // Should have stdout output
    const stdoutOutputs = outputs.filter((o) => o.type === "stdout");
    assertEquals(stdoutOutputs.length > 0, true);

    const stdoutText = stdoutOutputs.map((o) => o.data).join("");
    assertStringIncludes(stdoutText, "Hello from Pyodide!");
  });

  await t.step("test simple arithmetic", async () => {
    const { context, outputs } = createExecutionContext("2 + 2");

    const result = await agent.executeCell(context as unknown as any);

    assertEquals(result.success, true);

    // Should have result output
    const resultOutputs = outputs.filter((o) => o.type === "result");
    assertEquals(resultOutputs.length > 0, true);
  });

  await t.step("test Python variables", async () => {
    const { context, outputs } = createExecutionContext(`
x = 42
y = "test"
print(f"x = {x}, y = {y}")
x + len(y)
    `);

    const result = await (agent as unknown as {
      executeCell: (
        ctx: ExecutionContextLike,
      ) => Promise<{ success: boolean }>;
    }).executeCell(context);
    assertEquals(result.success, true);

    // Should have both stdout and result
    const stdoutOutputs = outputs.filter((o) => o.type === "stdout");
    const resultOutputs = outputs.filter((o) => o.type === "result");

    assertEquals(stdoutOutputs.length > 0, true);
    assertEquals(resultOutputs.length > 0, true);

    const stdoutText = stdoutOutputs.map((o) => o.data).join("");
    assertStringIncludes(stdoutText, "x = 42, y = test");
  });

  await t.step("test multiple print statements with newlines", async () => {
    const { context, outputs } = createExecutionContext(`
print('hey')
print('ok')
    `);

    const result = await (agent as unknown as {
      executeCell: (
        ctx: ExecutionContextLike,
      ) => Promise<{ success: boolean }>;
    }).executeCell(context);
    assertEquals(result.success, true);

    // Should have stdout output
    const stdoutOutputs = outputs.filter((o) => o.type === "stdout");
    assertEquals(stdoutOutputs.length > 0, true);

    const stdoutText = stdoutOutputs.map((o) => o.data).join("");

    // Check that we have proper newlines between outputs
    assertStringIncludes(stdoutText, "hey");
    assertStringIncludes(stdoutText, "ok");

    // Verify that the outputs are properly separated (not "heyok")
    // The exact format depends on how pyodide batches the output
    const hasProperSeparation = stdoutText.includes("hey\n") ||
      stdoutText.match(/hey.*\n.*ok/) ||
      stdoutOutputs.length > 1;
    assertEquals(
      hasProperSeparation,
      true,
      `Expected proper line separation, got: ${JSON.stringify(stdoutText)}`,
    );
  });

  await t.step("test Python error handling", async () => {
    const { context, outputs } = createExecutionContext(
      "raise ValueError('test error message')",
    );

    const result = await (agent as unknown as {
      executeCell: (
        ctx: ExecutionContextLike,
      ) => Promise<{ success: boolean; error?: string }>;
    }).executeCell(context);

    // Python errors are captured as error output, execution still "succeeds"
    assertEquals(result.success, true);

    // Should have error output
    const errorOutputs = outputs.filter((o) => o.type === "error");
    assertEquals(errorOutputs.length > 0, true);

    const errorData = errorOutputs[0]?.data as {
      ename: string;
      evalue: string;
      traceback: string[];
    };
    assertEquals(errorData.ename, "ValueError");
    assertEquals(errorData.evalue.includes("test error message"), true);
  });

  await t.step("test execution cancellation", async () => {
    const { context, outputs: _outputs, abortController } =
      createExecutionContext(`
for i in range(3):
    print(f"Step {i}")
print("Should not reach here")
    `);

    // Cancel immediately before execution
    abortController.abort();

    const result = await (agent as unknown as {
      executeCell: (
        ctx: ExecutionContextLike,
      ) => Promise<{ success: boolean; error?: string }>;
    }).executeCell(context);

    // Should fail due to cancellation
    assertEquals(result.success, false);
    assertEquals(result.error?.includes("cancelled"), true);
  });

  await t.step("test micropip availability", async () => {
    const { context, outputs } = createExecutionContext(`
import micropip
print("micropip version:", micropip.__version__)
    `);

    const result = await (agent as unknown as {
      executeCell: (
        ctx: ExecutionContextLike,
      ) => Promise<{ success: boolean }>;
    }).executeCell(context);
    assertEquals(result.success, true);

    const stdoutOutputs = outputs.filter((o) => o.type === "stdout");
    const stdoutText = stdoutOutputs.map((o) => o.data).join("");
    assertStringIncludes(stdoutText, "micropip version:");
  });

  await t.step("test ipython display system", async () => {
    const { context, outputs } = createExecutionContext(`
from IPython.display import HTML, display
display(HTML("<b>Bold text from IPython</b>"))
    `);

    const result = await (agent as unknown as {
      executeCell: (
        ctx: ExecutionContextLike,
      ) => Promise<{ success: boolean }>;
    }).executeCell(context);
    assertEquals(result.success, true);

    // Should have display output with HTML
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

// Test that would require additional packages (currently skipped)
Deno.test({
  name: "Python with scientific packages",
  ignore: true, // Enable when we want to test with more packages
  sanitizeOps: false,
  sanitizeResources: false,
}, async () => {
  const agent = new PyodideRuntimeAgent(
    ["--kernel-id", "full-test", "--notebook", "test", "--auth-token", "token"],
    { packages: ["micropip", "ipython", "numpy", "matplotlib", "pandas"] }, // Scientific stack
  );

  await agent.start();

  const { context } = createExecutionContext(`
import numpy as np
arr = np.array([1, 2, 3, 4, 5])
print("Array:", arr)
print("Sum:", arr.sum())
  `);

  const result = await (agent as unknown as {
    executeCell: (
      ctx: ExecutionContextLike,
    ) => Promise<{ success: boolean }>;
  }).executeCell(context);
  assertEquals(result.success, true);

  await agent.shutdown();
});

// deno-lint-ignore-file no-explicit-any
// ExecutionContext output methods tests

import { assertEquals } from "jsr:@std/assert";
import type { ExecutionContext } from "./types.ts";

// Simple test that verifies ExecutionContext method signatures exist and work
Deno.test("ExecutionContext - method signatures", () => {
  // Create a minimal mock context that implements all required methods
  const outputs: Array<{ type: string; data: unknown }> = [];

  const context: ExecutionContext = {
    cell: {
      id: "test-cell",
      cellType: "code",
      source: "print('test')",
      position: 0,
    } as ExecutionContext["cell"],
    queueEntry: {
      id: "test-queue",
      cellId: "test-cell",
    } as ExecutionContext["queueEntry"],
    store: {} as ExecutionContext["store"],
    sessionId: "test-session",
    kernelId: "test-kernel",
    abortSignal: new AbortController().signal,
    checkCancellation: () => {},

    stdout: (text: string) => {
      outputs.push({ type: "stdout", data: text });
    },

    stderr: (text: string) => {
      outputs.push({ type: "stderr", data: text });
    },

    display: (data, metadata, displayId) => {
      outputs.push({ type: "display", data: { data, metadata, displayId } });
    },

    updateDisplay: (displayId, data, metadata) => {
      outputs.push({
        type: "updateDisplay",
        data: { displayId, data, metadata },
      });
    },

    result: (data, metadata) => {
      outputs.push({ type: "result", data: { data, metadata } });
    },

    error: (ename, evalue, traceback) => {
      outputs.push({ type: "error", data: { ename, evalue, traceback } });
    },

    clear: (wait = false) => {
      outputs.push({ type: "clear", data: { wait } });
    },

    appendTerminal: (outputId, text) => {
      outputs.push({ type: "appendTerminal", data: { outputId, text } });
    },

    markdown: (content, metadata) => {
      outputs.push({ type: "markdown", data: { content, metadata } });
      return "mock-markdown-id";
    },

    appendMarkdown: (outputId, content) => {
      outputs.push({ type: "appendMarkdown", data: { outputId, content } });
    },
  };

  // Test stdout
  context.stdout("Hello stdout");
  assertEquals(outputs[0].type, "stdout");
  assertEquals(outputs[0].data, "Hello stdout");

  // Test stderr
  context.stderr("Error message");
  assertEquals(outputs[1].type, "stderr");
  assertEquals(outputs[1].data, "Error message");

  // Test display
  context.display({ "text/plain": "Hello" }, { custom: true }, "display-1");
  assertEquals(outputs[2].type, "display");
  assertEquals((outputs[2].data as any).data["text/plain"], "Hello");
  assertEquals((outputs[2].data as any).metadata.custom, true);
  assertEquals((outputs[2].data as any).displayId, "display-1");

  // Test result
  context.result({ "application/json": { value: 42 } }, { count: 1 });
  assertEquals(outputs[3].type, "result");
  assertEquals((outputs[3].data as any).data["application/json"].value, 42);
  assertEquals((outputs[3].data as any).metadata.count, 1);

  // Test error
  context.error("ValueError", "Invalid input", ["Traceback", "Line 1"]);
  assertEquals(outputs[4].type, "error");
  assertEquals((outputs[4].data as any).ename, "ValueError");
  assertEquals((outputs[4].data as any).evalue, "Invalid input");
  assertEquals((outputs[4].data as any).traceback.length, 2);

  // Test clear
  context.clear(true);
  assertEquals(outputs[5].type, "clear");
  assertEquals((outputs[5].data as any).wait, true);

  // Test appendTerminal
  context.appendTerminal("output-123", " more text");
  assertEquals(outputs[6].type, "appendTerminal");
  assertEquals((outputs[6].data as any).outputId, "output-123");
  assertEquals((outputs[6].data as any).text, " more text");

  // Test markdown
  context.markdown("# Hello World", { source: "ai" });
  assertEquals(outputs[7].type, "markdown");
  assertEquals((outputs[7].data as any).content, "# Hello World");
  assertEquals((outputs[7].data as any).metadata.source, "ai");

  // Test appendMarkdown
  context.appendMarkdown("md-456", "\n\nMore content");
  assertEquals(outputs[8].type, "appendMarkdown");
  assertEquals((outputs[8].data as any).outputId, "md-456");
  assertEquals((outputs[8].data as any).content, "\n\nMore content");

  assertEquals(outputs.length, 9);
});

// Test that empty strings are handled correctly
Deno.test("ExecutionContext - empty string handling", () => {
  const outputs: string[] = [];

  const context: ExecutionContext = {
    cell: { id: "test" } as ExecutionContext["cell"],
    queueEntry: { id: "test" } as ExecutionContext["queueEntry"],
    store: {} as ExecutionContext["store"],
    sessionId: "test",
    kernelId: "test",
    abortSignal: new AbortController().signal,
    checkCancellation: () => {},

    stdout: (text: string) => {
      if (text) outputs.push(`stdout:${text}`);
    },

    stderr: (text: string) => {
      if (text) outputs.push(`stderr:${text}`);
    },

    display: () => {},
    updateDisplay: () => {},
    result: () => {},
    error: () => {},
    clear: () => {},
    appendTerminal: () => {},
    markdown: () => "mock-markdown-id",
    appendMarkdown: () => {},
  };

  // Empty strings should be filtered out
  context.stdout("");
  context.stderr("");
  assertEquals(outputs.length, 0);

  // Non-empty strings should be processed
  context.stdout("actual content");
  context.stderr("error content");
  assertEquals(outputs.length, 2);
  assertEquals(outputs[0], "stdout:actual content");
  assertEquals(outputs[1], "stderr:error content");

  // Whitespace should be preserved
  context.stdout("   ");
  context.stderr("\n");
  assertEquals(outputs.length, 4);
  assertEquals(outputs[2], "stdout:   ");
  assertEquals(outputs[3], "stderr:\n");
});

// Test new streaming methods exist
Deno.test("ExecutionContext - streaming methods", () => {
  let called = false;

  const context: ExecutionContext = {
    cell: { id: "test" } as ExecutionContext["cell"],
    queueEntry: { id: "test" } as ExecutionContext["queueEntry"],
    store: {} as ExecutionContext["store"],
    sessionId: "test",
    kernelId: "test",
    abortSignal: new AbortController().signal,
    checkCancellation: () => {},

    stdout: () => {},
    stderr: () => {},
    display: () => {},
    updateDisplay: () => {},
    result: () => {},
    error: () => {},
    clear: () => {},

    // These are the new streaming methods
    appendTerminal: (outputId: string, text: string) => {
      assertEquals(outputId, "test-output-id");
      assertEquals(text, "appended text");
      called = true;
    },

    markdown: (content: string, metadata?: Record<string, unknown>) => {
      assertEquals(content, "# Markdown");
      assertEquals(metadata?.type, "ai");
      called = true;
      return "mock-markdown-id";
    },

    appendMarkdown: (outputId: string, content: string) => {
      assertEquals(outputId, "md-output-id");
      assertEquals(content, " more markdown");
      called = true;
    },
  };

  // Test appendTerminal
  called = false;
  context.appendTerminal("test-output-id", "appended text");
  assertEquals(called, true);

  // Test markdown
  called = false;
  context.markdown("# Markdown", { type: "ai" });
  assertEquals(called, true);

  // Test appendMarkdown
  called = false;
  context.appendMarkdown("md-output-id", " more markdown");
  assertEquals(called, true);
});

// Test clear method with wait parameter
Deno.test("ExecutionContext - clear with wait parameter", () => {
  const clearCalls: Array<{ wait: boolean }> = [];

  const context: ExecutionContext = {
    cell: { id: "test" } as ExecutionContext["cell"],
    queueEntry: { id: "test" } as ExecutionContext["queueEntry"],
    store: {} as ExecutionContext["store"],
    sessionId: "test",
    kernelId: "test",
    abortSignal: new AbortController().signal,
    checkCancellation: () => {},

    stdout: () => {},
    stderr: () => {},
    display: () => {},
    updateDisplay: () => {},
    result: () => {},
    error: () => {},
    appendTerminal: () => {},
    markdown: () => "mock-markdown-id",
    appendMarkdown: () => {},

    clear: (wait = false) => {
      clearCalls.push({ wait });
    },
  };

  // Test default parameter
  context.clear();
  assertEquals(clearCalls[0].wait, false);

  // Test explicit false
  context.clear(false);
  assertEquals(clearCalls[1].wait, false);

  // Test explicit true
  context.clear(true);
  assertEquals(clearCalls[2].wait, true);

  assertEquals(clearCalls.length, 3);
});

import { assert, assertEquals } from "jsr:@std/assert";
import { RuntOpenAIClient } from "../src/openai-client.ts";
import type { ExecutionContext } from "@runt/lib";
import type { CellData, ExecutionQueueData } from "@runt/schema";
import type { Store } from "npm:@livestore/livestore";
import { schema } from "@runt/schema";

Deno.test("OpenAI Client - Immediate Output Emission", async () => {
  // Mock OpenAI API key for testing
  const originalApiKey = Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("OPENAI_API_KEY", "test-key-for-immediate-output");

  try {
    const client = new RuntOpenAIClient();
    client.configure();

    // Track the order of events
    const events: Array<{ type: string; timestamp: number; data?: unknown }> =
      [];

    // Mock execution context that records events with timestamps
    const mockContext: ExecutionContext = {
      cell: {} as CellData,
      queueEntry: {} as ExecutionQueueData,
      store: {} as Store<typeof schema>,
      sessionId: "test-session",
      kernelId: "test-kernel",
      abortSignal: new AbortController().signal,
      checkCancellation: () => {},
      stdout: () => {},
      stderr: () => {},
      display: (data, metadata) => {
        events.push({
          type: "display_output",
          timestamp: Date.now(),
          data: { displayData: data, metadata },
        });
      },
      result: () => {},
      error: () => {},
      clear: () => {},
      updateDisplay: () => {},
    };

    // Mock client that simulates slow tool execution
    const originalClient = (client as unknown as { client: unknown }).client;
    (client as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create: () => ({
            choices: [{
              message: {
                content: "I'll create a cell now.",
                tool_calls: [{
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "create_cell",
                    arguments: JSON.stringify({
                      cellType: "code",
                      content: "print('Test immediate output')",
                      position: "after_current",
                    }),
                  },
                }],
              },
            }],
            usage: {
              prompt_tokens: 50,
              completion_tokens: 25,
              total_tokens: 75,
            },
          }),
        },
      },
    };

    // Record when tool call starts and completes
    const toolCallEvents: Array<{ event: string; timestamp: number }> = [];

    await client.generateAgenticResponse(
      [
        { role: "system", content: "You are a helpful AI assistant." },
        { role: "user", content: "Create a test cell" },
      ],
      mockContext,
      {
        model: "gpt-4o-mini",
        enableTools: true,
        maxIterations: 1,
        onToolCall: async (_toolCall) => {
          toolCallEvents.push({
            event: "tool_call_start",
            timestamp: Date.now(),
          });

          // Simulate some processing time
          await new Promise((resolve) => setTimeout(resolve, 10));

          toolCallEvents.push({
            event: "tool_call_complete",
            timestamp: Date.now(),
          });

          return "Cell created successfully";
        },
      },
    );

    // Verify that we have the expected events
    assert(events.length > 0, "Should have display events");
    assert(toolCallEvents.length === 2, "Should have tool call start/complete");

    // Find the tool execution confirmation event
    const toolOutputEvent = events.find((e) =>
      e.type === "display_output" &&
      typeof e.data === "object" &&
      e.data !== null &&
      "displayData" in e.data &&
      typeof e.data.displayData === "object" &&
      e.data.displayData !== null &&
      "text/markdown" in e.data.displayData &&
      typeof e.data.displayData["text/markdown"] === "string" &&
      e.data.displayData["text/markdown"].includes("🔧 **Tool executed**")
    );

    assert(toolOutputEvent, "Should have tool execution confirmation output");

    // Verify timing: tool output should be emitted immediately after tool completes
    const toolCompleteTime = toolCallEvents.find((e) =>
      e.event === "tool_call_complete"
    )?.timestamp;
    const outputEmitTime = toolOutputEvent.timestamp;

    assert(toolCompleteTime, "Should have tool complete time");
    assert(outputEmitTime, "Should have output emit time");

    // Output should be emitted very close to when tool completes (within 100ms)
    const timeDiff = outputEmitTime - toolCompleteTime;
    assert(
      timeDiff >= 0 && timeDiff < 100,
      `Output should be emitted immediately after tool completion. Time diff: ${timeDiff}ms`,
    );

    console.log("✅ Immediate output emission verified");
    console.log(`⏱️  Tool execution to output emission: ${timeDiff}ms`);

    // Restore original client
    (client as unknown as { client: unknown }).client = originalClient;
  } finally {
    // Restore original API key
    if (originalApiKey) {
      Deno.env.set("OPENAI_API_KEY", originalApiKey);
    } else {
      Deno.env.delete("OPENAI_API_KEY");
    }
  }
});

Deno.test("OpenAI Client - Multiple Tool Calls Stream Individually", async () => {
  // Mock OpenAI API key for testing
  const originalApiKey = Deno.env.get("OPENAI_API_KEY");
  Deno.env.set("OPENAI_API_KEY", "test-key-for-streaming");

  try {
    const client = new RuntOpenAIClient();
    client.configure();

    const displayEvents: Array<{
      timestamp: number;
      content: string;
    }> = [];

    const mockContext: ExecutionContext = {
      cell: {} as CellData,
      queueEntry: {} as ExecutionQueueData,
      store: {} as Store<typeof schema>,
      sessionId: "test-session",
      kernelId: "test-kernel",
      abortSignal: new AbortController().signal,
      checkCancellation: () => {},
      stdout: () => {},
      stderr: () => {},
      display: (data) => {
        if (
          typeof data === "object" && data !== null &&
          "text/markdown" in data &&
          typeof data["text/markdown"] === "string"
        ) {
          displayEvents.push({
            timestamp: Date.now(),
            content: data["text/markdown"],
          });
        }
      },
      result: () => {},
      error: () => {},
      clear: () => {},
      updateDisplay: () => {},
    };

    // Mock client that returns multiple tool calls
    const originalClient = (client as unknown as { client: unknown }).client;
    (client as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create: () => ({
            choices: [{
              message: {
                content: "I'll create multiple cells.",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "create_cell",
                      arguments: JSON.stringify({
                        cellType: "code",
                        content: "print('First cell')",
                        position: "after_current",
                      }),
                    },
                  },
                  {
                    id: "call_2",
                    type: "function",
                    function: {
                      name: "create_cell",
                      arguments: JSON.stringify({
                        cellType: "code",
                        content: "print('Second cell')",
                        position: "after_current",
                      }),
                    },
                  },
                ],
              },
            }],
            usage: {
              prompt_tokens: 50,
              completion_tokens: 25,
              total_tokens: 75,
            },
          }),
        },
      },
    };

    let toolCallCount = 0;
    const toolExecutionTimes: number[] = [];

    await client.generateAgenticResponse(
      [
        { role: "system", content: "You are a helpful AI assistant." },
        { role: "user", content: "Create multiple cells" },
      ],
      mockContext,
      {
        model: "gpt-4o-mini",
        enableTools: true,
        maxIterations: 1,
        onToolCall: async (_toolCall) => {
          toolCallCount++;
          const startTime = Date.now();

          // Simulate varying processing times
          const delay = toolCallCount === 1 ? 20 : 5;
          await new Promise((resolve) => setTimeout(resolve, delay));

          toolExecutionTimes.push(Date.now() - startTime);
          return `Tool ${toolCallCount} executed`;
        },
      },
    );

    // Should have executed 2 tool calls
    assertEquals(toolCallCount, 2, "Should have executed 2 tool calls");

    // Should have at least 3 display events (2 tool confirmations + 1 text content)
    assert(
      displayEvents.length >= 3,
      `Should have at least 3 display events, got ${displayEvents.length}`,
    );

    // Find tool execution events
    const toolEvents = displayEvents.filter((e) =>
      e.content.includes("🔧 **Tool executed**")
    );

    assertEquals(toolEvents.length, 2, "Should have 2 tool execution events");

    // Verify that tool events are emitted in order and individually
    const timeBetweenToolOutputs = toolEvents[1]!.timestamp -
      toolEvents[0]!.timestamp;

    // The second tool output should come after the first
    assert(
      timeBetweenToolOutputs > 0,
      "Tool outputs should be emitted sequentially",
    );

    console.log("✅ Multiple tool calls stream individually");
    console.log(
      `⏱️  Time between tool outputs: ${timeBetweenToolOutputs}ms`,
    );

    // Restore original client
    (client as unknown as { client: unknown }).client = originalClient;
  } finally {
    // Restore original API key
    if (originalApiKey) {
      Deno.env.set("OPENAI_API_KEY", originalApiKey);
    } else {
      Deno.env.delete("OPENAI_API_KEY");
    }
  }
});

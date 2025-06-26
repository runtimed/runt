import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { RuntOpenAIClient } from "../src/openai-client.ts";
import type { ExecutionContext } from "@runt/lib";
import type { CellData, ExecutionQueueData } from "@runt/schema";
import type { Store } from "npm:@livestore/livestore";
import { schema } from "@runt/schema";

// Helper function to create mock execution context for testing
function createMockContext() {
  const outputs: Array<{
    type: "display_data" | "error" | "execute_result";
    data: Record<string, unknown>;
    metadata?: Record<string, unknown>;
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
    display: (data, metadata) => {
      outputs.push({
        type: "display_data",
        data: data as Record<string, unknown>,
        metadata: metadata || {},
      });
    },
    result: (data) => {
      outputs.push({
        type: "execute_result",
        data: data as Record<string, unknown>,
      });
    },
    error: (ename, evalue, traceback) => {
      outputs.push({
        type: "error",
        data: { ename, evalue, traceback },
      });
    },
    clear: () => {},
    updateDisplay: (displayId, data, metadata) => {
      // Find and update existing outputs with matching displayId
      for (let i = 0; i < outputs.length; i++) {
        const output = outputs[i];
        if (output && output.metadata?.display_id === displayId) {
          output.data = data as Record<string, unknown>;
          output.metadata = metadata || {};
        }
      }
    },
  };

  return { mockContext, outputs };
}

Deno.test("OpenAI Client - Agentic Tool Calls", async (t) => {
  // Mock OpenAI API key for testing
  const originalApiKey = Deno.env.get("OPENAI_API_KEY");

  await t.step("setup - set mock API key", () => {
    Deno.env.set("OPENAI_API_KEY", "test-key-for-mocking");
  });

  await t.step("agentic conversation with tool calls", async () => {
    const client = new RuntOpenAIClient();
    client.configure();

    // Track tool calls and iterations
    const toolCalls: Array<{
      name: string;
      arguments: Record<string, unknown>;
    }> = [];
    const iterations: number[] = [];

    // Mock the OpenAI client to simulate tool calls and follow-up responses
    const originalClient = (client as unknown as { client: unknown }).client;
    let callCount = 0;

    (client as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create: (_params: unknown) => {
            callCount++;

            if (callCount === 1) {
              // First call: AI decides to create a cell
              return {
                choices: [{
                  message: {
                    content: "I'll create a Python cell for you.",
                    tool_calls: [{
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "create_cell",
                        arguments: JSON.stringify({
                          cellType: "code",
                          content: "print('Hello, World!')",
                          position: "after_current",
                        }),
                      },
                    }],
                  },
                }],
                usage: {
                  prompt_tokens: 100,
                  completion_tokens: 50,
                  total_tokens: 150,
                },
              };
            } else if (callCount === 2) {
              // Second call: AI responds to tool call result
              return {
                choices: [{
                  message: {
                    content:
                      "Great! I've created a Python cell that prints 'Hello, World!'. You can now execute it to see the output.",
                    tool_calls: null,
                  },
                }],
                usage: {
                  prompt_tokens: 150,
                  completion_tokens: 30,
                  total_tokens: 180,
                },
              };
            }

            throw new Error("Unexpected call count");
          },
        },
      },
    };

    const { mockContext, outputs } = createMockContext();

    await client.generateAgenticResponse(
      "Create a simple Python hello world program",
      mockContext,
      {
        model: "gpt-4o-mini",
        enableTools: true,
        maxIterations: 10,
        onToolCall: (toolCall) => {
          toolCalls.push({
            name: toolCall.name,
            arguments: toolCall.arguments,
          });

          // Simulate successful tool execution
          if (toolCall.name === "create_cell") {
            return Promise.resolve(
              `Created code cell with content: ${toolCall.arguments.content}`,
            );
          }
          return Promise.resolve("Tool executed successfully");
        },
        onIteration: (iteration, _messages) => {
          iterations.push(iteration);
          return Promise.resolve(true); // Continue
        },
      },
    );

    // Verify tool calls occurred
    assertEquals(toolCalls.length, 1, "Should have one tool call");
    assertEquals(toolCalls[0]!.name, "create_cell", "Should call create_cell");
    assertEquals(
      toolCalls[0]!.arguments.cellType,
      "code",
      "Should create code cell",
    );
    assertEquals(
      toolCalls[0]!.arguments.content,
      "print('Hello, World!')",
      "Should have expected content",
    );

    // Verify iterations
    assertEquals(iterations.length, 2, "Should have two iterations");
    assertEquals(iterations[0], 0, "First iteration should be 0");
    assertEquals(iterations[1], 1, "Second iteration should be 1");

    // Verify outputs structure
    assert(outputs.length >= 2, "Should have at least 2 outputs");

    // First output should be tool execution confirmation
    const toolOutput = outputs.find((o) =>
      o.metadata?.["anode/tool_call"] === true &&
      o.metadata?.["anode/tool_name"] === "create_cell"
    );
    assertExists(toolOutput, "Should have tool call output");
    assertEquals(
      (toolOutput.data["text/plain"] as string).includes("Tool executed"),
      true,
      "Should confirm tool execution",
    );

    // Should have final AI response
    const finalResponse = outputs.find((o) =>
      o.metadata?.["anode/final_response"] === true
    );
    assertExists(finalResponse, "Should have final AI response");
    assertEquals(
      (finalResponse.data["text/markdown"] as string).includes(
        "Great! I've created",
      ),
      true,
      "Should have follow-up response",
    );

    console.log("✅ Agentic conversation with tool calls verified");

    // Restore original client
    (client as unknown as { client: unknown }).client = originalClient;
  });

  await t.step("max iterations limit", async () => {
    const client = new RuntOpenAIClient();
    client.configure();

    let iterationCount = 0;

    // Mock client that always returns tool calls
    const originalClient = (client as unknown as { client: unknown }).client;
    (client as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create: () => ({
            choices: [{
              message: {
                content: "I need to keep calling tools.",
                tool_calls: [{
                  id: `call_${iterationCount}`,
                  type: "function",
                  function: {
                    name: "create_cell",
                    arguments: JSON.stringify({
                      cellType: "code",
                      content: `# Iteration ${iterationCount}`,
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

    const { mockContext, outputs } = createMockContext();

    await client.generateAgenticResponse(
      "Keep creating cells",
      mockContext,
      {
        maxIterations: 2,
        enableTools: true,
        onToolCall: () => {
          iterationCount++;
          return Promise.resolve("Tool executed");
        },
      },
    );

    // Should hit max iterations
    const maxIterationsOutput = outputs.find((o) =>
      o.metadata?.["anode/max_iterations_reached"] === true
    );
    assertExists(maxIterationsOutput, "Should have max iterations warning");
    assertEquals(
      (maxIterationsOutput.data["text/markdown"] as string).includes(
        "maximum iterations",
      ),
      true,
      "Should warn about max iterations",
    );

    console.log("✅ Max iterations limit verified");

    // Restore original client
    (client as unknown as { client: unknown }).client = originalClient;
  });

  await t.step("interrupt handling", async () => {
    const client = new RuntOpenAIClient();
    client.configure();

    const abortController = new AbortController();
    let iterationCount = 0;

    // Mock client
    const originalClient = (client as unknown as { client: unknown }).client;
    (client as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create: () => {
            if (iterationCount === 1) {
              // Abort on second iteration
              abortController.abort();
            }
            return {
              choices: [{
                message: {
                  content: "Creating another cell",
                  tool_calls: [{
                    id: `call_${iterationCount}`,
                    type: "function",
                    function: {
                      name: "create_cell",
                      arguments: JSON.stringify({
                        cellType: "code",
                        content: "pass",
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
            };
          },
        },
      },
    };

    const { mockContext, outputs } = createMockContext();
    mockContext.abortSignal = abortController.signal;

    await client.generateAgenticResponse(
      "Create multiple cells",
      mockContext,
      {
        maxIterations: 10,
        enableTools: true,
        interruptSignal: abortController.signal,
        onToolCall: () => {
          iterationCount++;
          return Promise.resolve("Tool executed");
        },
      },
    );

    // Should have stopped due to interrupt
    assert(outputs.length > 0, "Should have some outputs before interruption");

    // Should not reach max iterations due to early abort
    const maxIterationsOutput = outputs.find((o) =>
      o.metadata?.["anode/max_iterations_reached"] === true
    );
    assertEquals(
      maxIterationsOutput,
      undefined,
      "Should not reach max iterations due to abort",
    );

    console.log("✅ Interrupt handling verified");

    // Restore original client
    (client as unknown as { client: unknown }).client = originalClient;
  });

  await t.step("tool call errors", async () => {
    const client = new RuntOpenAIClient();
    client.configure();

    // Mock client that returns invalid tool arguments
    const originalClient = (client as unknown as { client: unknown }).client;
    (client as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create: () => ({
            choices: [{
              message: {
                content: "I'll create a cell with invalid args.",
                tool_calls: [{
                  id: "call_error",
                  type: "function",
                  function: {
                    name: "create_cell",
                    arguments: "invalid-json{{",
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

    const { mockContext, outputs } = createMockContext();

    await client.generateAgenticResponse(
      "Create a cell",
      mockContext,
      {
        maxIterations: 2,
        enableTools: true,
        onToolCall: () => {
          return Promise.reject(
            new Error("Should not be called with invalid JSON"),
          );
        },
      },
    );

    // Should have error output
    const errorOutput = outputs.find((o) =>
      o.metadata?.["anode/tool_error"] === true
    );
    assertExists(errorOutput, "Should have tool error output");
    assertEquals(
      (errorOutput.data["text/markdown"] as string).includes(
        "Error parsing arguments",
      ),
      true,
      "Should show JSON parsing error",
    );

    console.log("✅ Tool call error handling verified");

    // Restore original client
    (client as unknown as { client: unknown }).client = originalClient;
  });

  await t.step("execute_cell with results", async () => {
    const client = new RuntOpenAIClient();
    client.configure();

    const executionResults: string[] = [];

    // Mock client that executes a cell and provides results
    const originalClient = (client as unknown as { client: unknown }).client;
    let callCount = 0;
    (client as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create: () => {
            callCount++;

            if (callCount === 1) {
              return {
                choices: [{
                  message: {
                    content: "I'll execute the cell and show you the result.",
                    tool_calls: [{
                      id: "call_execute",
                      type: "function",
                      function: {
                        name: "execute_cell",
                        arguments: JSON.stringify({
                          cellId: "test-cell-123",
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
              };
            } else {
              // Second iteration: AI responds to execution result
              return {
                choices: [{
                  message: {
                    content:
                      "Perfect! The cell executed and returned 0.123456789 as expected.",
                    tool_calls: null,
                  },
                }],
                usage: {
                  prompt_tokens: 70,
                  completion_tokens: 15,
                  total_tokens: 85,
                },
              };
            }
          },
        },
      },
    };

    const { mockContext, outputs } = createMockContext();

    await client.generateAgenticResponse(
      "Execute the code cell",
      mockContext,
      {
        maxIterations: 2,
        enableTools: true,
        onToolCall: (toolCall) => {
          if (toolCall.name === "execute_cell") {
            const result =
              "Cell test-cell-123 executed successfully. Result: 0.123456789";
            executionResults.push(result);
            return Promise.resolve(result);
          }
          return Promise.resolve("Tool executed");
        },
      },
    );

    // Verify execution was attempted (AI calls execute_cell once)
    assertEquals(executionResults.length, 1, "Should have executed cell");
    assertEquals(
      executionResults[0]!.includes("test-cell-123"),
      true,
      "Should reference the correct cell ID",
    );
    assertEquals(
      executionResults[0]!.includes("0.123456789"),
      true,
      "Should include execution result",
    );

    // Should have tool execution output
    const toolOutput = outputs.find((o) =>
      o.metadata?.["anode/tool_call"] === true &&
      o.metadata?.["anode/tool_name"] === "execute_cell"
    );
    assertExists(toolOutput, "Should have execute_cell tool output");

    console.log("✅ Execute cell with results verified");

    // Restore original client
    (client as unknown as { client: unknown }).client = originalClient;
  });

  await t.step("cleanup - restore API key", () => {
    if (originalApiKey) {
      Deno.env.set("OPENAI_API_KEY", originalApiKey);
    } else {
      Deno.env.delete("OPENAI_API_KEY");
    }
  });
});

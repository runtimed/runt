import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { RuntOpenAIClient } from "../openai-client.ts";
import type { ExecutionContext } from "@runt/lib";

// Test utilities
interface TestOutput {
  type: string;
  data: Record<string, unknown>;
  metadata?: unknown;
}

function createMockExecutionContext(): {
  context: ExecutionContext;
  outputs: TestOutput[];
  markdownOutputs: Map<string, string>;
  getMarkdownContent: (outputId: string) => string;
} {
  const outputs: TestOutput[] = [];
  const markdownOutputs = new Map<string, string>();
  let nextOutputId = 0;

  const context: ExecutionContext = {
    cell: {
      id: "test-cell",
      cellType: "ai",
      source: "test ai call",
      position: 0,
    } as ExecutionContext["cell"],
    queueEntry: {
      id: "test-queue",
      cellId: "test-cell",
    } as ExecutionContext["queueEntry"],
    store: {} as ExecutionContext["store"],
    sessionId: "test-session",
    runtimeId: "test-runtime",
    abortSignal: new AbortController().signal,
    checkCancellation: () => {},

    stdout: (text: string) => {
      outputs.push({ type: "stdout", data: { text } });
    },

    stderr: (text: string) => {
      outputs.push({ type: "stderr", data: { text } });
    },

    display: (data: unknown, metadata?: unknown) => {
      outputs.push({
        type: "display",
        data: data as Record<string, unknown>,
        metadata,
      });
    },

    updateDisplay: (displayId: string, data: unknown, metadata?: unknown) => {
      outputs.push({
        type: "updateDisplay",
        data: { displayId, data, metadata },
      });
    },

    result: (data: unknown, metadata?: unknown) => {
      outputs.push({
        type: "result",
        data: data as Record<string, unknown>,
        metadata,
      });
    },

    error: (name: string, message: string, traceback: string[]) => {
      outputs.push({ type: "error", data: { name, message, traceback } });
    },

    clear: (_wait?: boolean) => {
      outputs.splice(0, outputs.length);
    },

    appendTerminal: (outputId: string, text: string) => {
      outputs.push({ type: "appendTerminal", data: { outputId, text } });
    },

    markdown: (content: string, metadata?: Record<string, unknown>) => {
      const outputId = `md-${nextOutputId++}`;
      markdownOutputs.set(outputId, content);
      outputs.push({
        type: "markdown",
        data: { outputId, content, metadata },
      });
      return outputId;
    },

    appendMarkdown: (outputId: string, content: string) => {
      const existing = markdownOutputs.get(outputId) || "";
      markdownOutputs.set(outputId, existing + content);
      outputs.push({ type: "appendMarkdown", data: { outputId, content } });
    },
  };

  const getMarkdownContent = (outputId: string): string => {
    return markdownOutputs.get(outputId) || "";
  };

  return { context, outputs, markdownOutputs, getMarkdownContent };
}

// Mock OpenAI streaming response
class MockStreamingResponse {
  private chunks: Array<{
    choices: Array<{
      delta: {
        content?: string;
        tool_calls?: Array<{
          index: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  }>;

  constructor(chunks: typeof MockStreamingResponse.prototype.chunks) {
    this.chunks = chunks;
  }

  async *[Symbol.asyncIterator]() {
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

Deno.test("OpenAI Client - Streaming Markdown", async (t) => {
  await t.step("should stream markdown content token by token", async () => {
    const client = new RuntOpenAIClient();
    const { context, outputs, getMarkdownContent } =
      createMockExecutionContext();

    // Mock the OpenAI client to return streaming response
    const mockCreate = () => {
      return new MockStreamingResponse([
        { choices: [{ delta: { content: "Hello" } }] },
        { choices: [{ delta: { content: " world" } }] },
        { choices: [{ delta: { content: "!" } }] },
        { choices: [{ delta: { content: "\n\nThis is" } }] },
        { choices: [{ delta: { content: " a test." } }] },
      ]);
    };

    // Configure with mock API key
    client.configure({ apiKey: "test-key" });

    // Mock the client.chat.completions.create method
    const originalClient = (client as unknown as { client: unknown }).client;
    (client as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    };

    const messages = [
      { role: "user" as const, content: "Hello!" },
    ];

    await client.generateAgenticResponse(messages, context, {
      model: "gpt-4o-mini",
      enableTools: false,
    });

    // Verify that markdown output was created
    assertEquals(outputs.length, 5); // 1 markdown + 4 appendMarkdown calls

    // First output should be markdown creation
    assertEquals(outputs[0].type, "markdown");
    assertEquals(outputs[0].data.content, "Hello");

    // Subsequent outputs should be appendMarkdown calls
    for (let i = 1; i < outputs.length; i++) {
      assertEquals(outputs[i].type, "appendMarkdown");
    }

    // Verify final markdown content
    const markdownId = (outputs[0].data as { outputId: string }).outputId;
    const finalContent = getMarkdownContent(markdownId);
    assertEquals(finalContent, "Hello world!\n\nThis is a test.");

    // Verify metadata includes AI provider info
    const metadata = (outputs[0].data as {
      metadata: {
        anode: { role: string; ai_provider: string; ai_model: string };
      };
    }).metadata;
    assertEquals(metadata.anode.role, "assistant");
    assertEquals(metadata.anode.ai_provider, "openai");
    assertEquals(metadata.anode.ai_model, "gpt-4o-mini");

    // Restore original client
    (client as unknown as { client: unknown }).client = originalClient;
  });

  await t.step(
    "should handle tool calls without streaming content",
    async () => {
      const client = new RuntOpenAIClient();
      const { context, outputs } = createMockExecutionContext();

      const mockCreate = () => {
        return new MockStreamingResponse([
          {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: "call_123",
                  function: { name: "create_cell" },
                }],
              },
            }],
          },
          {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  function: { arguments: '{"cell_type": "code"}' },
                }],
              },
            }],
          },
        ]);
      };

      client.configure({ apiKey: "test-key" });

      const originalClient = (client as unknown as { client: unknown }).client;
      (client as unknown as { client: unknown }).client = {
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      };

      const messages = [
        { role: "user" as const, content: "Create a code cell" },
      ];

      let toolCallReceived = false;
      const mockToolCall = (
        toolCall: { name: string; arguments: Record<string, unknown> },
      ) => {
        assertEquals(toolCall.name, "create_cell");
        assertEquals(
          (toolCall.arguments as { cell_type: string }).cell_type,
          "code",
        );
        toolCallReceived = true;
        return Promise.resolve("Cell created successfully");
      };

      await client.generateAgenticResponse(messages, context, {
        model: "gpt-4o-mini",
        enableTools: true,
        onToolCall: mockToolCall,
      });

      // Should not create markdown output when there's no content
      const markdownOutputs = outputs.filter((o) => o.type === "markdown");
      assertEquals(markdownOutputs.length, 0);

      // Should have received and processed tool call
      assertEquals(toolCallReceived, true);

      // Restore original client
      (client as unknown as { client: unknown }).client = originalClient;
    },
  );

  await t.step("should handle mixed content and tool calls", async () => {
    const client = new RuntOpenAIClient();
    const { context, outputs, getMarkdownContent } =
      createMockExecutionContext();

    const mockCreate = () => {
      return new MockStreamingResponse([
        { choices: [{ delta: { content: "I'll create a cell for you." } }] },
        { choices: [{ delta: { content: "\n\n" } }] },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: "call_456",
                function: {
                  name: "create_cell",
                  arguments: '{"cell_type": "code"}',
                },
              }],
            },
          }],
        },
      ]);
    };

    client.configure({ apiKey: "test-key" });

    const originalClient = (client as unknown as { client: unknown }).client;
    (client as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    };

    const messages = [
      { role: "user" as const, content: "Create a code cell" },
    ];

    let toolCallReceived = false;
    const mockToolCall = (toolCall: { name: string }) => {
      assertEquals(toolCall.name, "create_cell");
      toolCallReceived = true;
      return Promise.resolve("Cell created successfully");
    };

    await client.generateAgenticResponse(messages, context, {
      model: "gpt-4o-mini",
      enableTools: true,
      onToolCall: mockToolCall,
      maxIterations: 1, // Prevent infinite loop
    });

    // Should create markdown output for the content
    const markdownOutputs = outputs.filter((o) => o.type === "markdown");
    assertEquals(markdownOutputs.length, 1);

    // Should have content plus tool call
    const markdownId =
      (markdownOutputs[0].data as { outputId: string }).outputId;
    const finalContent = getMarkdownContent(markdownId);
    assertEquals(finalContent, "I'll create a cell for you.\n\n");

    // Should have processed tool call
    assertEquals(toolCallReceived, true);

    // Restore original client
    (client as unknown as { client: unknown }).client = originalClient;
  });
});

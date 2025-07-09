import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { RuntOllamaClient } from "../ollama-client.ts";
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

// Mock Ollama streaming response
class MockOllamaStreamingResponse {
  private chunks: Array<{
    message: {
      role: string;
      content?: string;
      tool_calls?: Array<{
        function: {
          name: string;
          arguments: Record<string, unknown>;
        };
      }>;
    };
    done: boolean;
  }>;

  constructor(chunks: typeof MockOllamaStreamingResponse.prototype.chunks) {
    this.chunks = chunks;
  }

  async *[Symbol.asyncIterator]() {
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

// Mock Ollama client
function createMockOllamaClient(overrides: {
  listResponse?: {
    models: Array<
      {
        name: string;
        modified_at: Date;
        size: number;
        digest: string;
        details: {
          family: string;
          parameter_size: string;
          quantization_level: string;
        };
      }
    >;
  };
  chatResponse?: MockOllamaStreamingResponse;
  pullResponse?: { status: string };
  shouldFailList?: boolean;
  shouldFailChat?: boolean;
  shouldFailPull?: boolean;
} = {}) {
  return {
    config: {},
    list: () => {
      if (overrides.shouldFailList) {
        throw new Error("Connection failed");
      }
      return overrides.listResponse || {
        models: [
          {
            name: "llama3.1",
            modified_at: new Date(),
            size: 1000000,
            digest: "sha256:test",
            details: {
              family: "llama",
              parameter_size: "8B",
              quantization_level: "Q4_0",
            },
          },
        ],
      };
    },
    chat: () => {
      if (overrides.shouldFailChat) {
        throw new Error("Chat failed");
      }
      return overrides.chatResponse || new MockOllamaStreamingResponse([
        {
          message: { role: "assistant", content: "Hello" },
          done: false,
        },
        {
          message: { role: "assistant", content: " world!" },
          done: true,
        },
      ]);
    },
    pull: () => {
      if (overrides.shouldFailPull) {
        throw new Error("Pull failed");
      }
      return overrides.pullResponse || { status: "success" };
    },
  };
}

Deno.test("Ollama Client - Configuration", async (t) => {
  await t.step("should configure with default host", () => {
    const client = new RuntOllamaClient();
    // After configuration, host should be set to default
    assertEquals(client["config"].host, "http://localhost:11434");
  });

  await t.step("should configure with custom host", () => {
    const client = new RuntOllamaClient({
      host: "http://custom-host:11434",
    });
    assertEquals(client["config"].host, "http://custom-host:11434");
  });

  await t.step("should configure with environment variable", () => {
    Deno.env.set("OLLAMA_HOST", "http://env-host:11434");
    const client = new RuntOllamaClient();
    client.configure();
    Deno.env.delete("OLLAMA_HOST");
  });
});

Deno.test("Ollama Client - Model Management", async (t) => {
  await t.step("should get available models", async () => {
    const client = new RuntOllamaClient();
    const mockClient = createMockOllamaClient({
      listResponse: {
        models: [
          {
            name: "llama3.1",
            modified_at: new Date(),
            size: 1000000,
            digest: "sha256:test",
            details: {
              family: "llama",
              parameter_size: "8B",
              quantization_level: "Q4_0",
            },
          },
        ],
      },
    });

    client["client"] = mockClient as unknown as typeof client["client"];
    client["isConfigured"] = true;

    const models = await client.getAvailableModels();
    assertEquals(models.length, 1);
    assertEquals(models[0].name, "llama3.1");
    assertEquals(models[0].details.family, "llama");
  });

  await t.step("should handle model fetch failure", async () => {
    const client = new RuntOllamaClient();
    const mockClient = createMockOllamaClient({
      shouldFailList: true,
    });

    client["client"] = mockClient as unknown as typeof client["client"];
    client["isConfigured"] = true;

    await assertRejects(
      () => client.getAvailableModels(),
      Error,
      "Connection failed",
    );
  });

  await t.step("should ensure model exists - model present", async () => {
    const client = new RuntOllamaClient();
    const mockClient = createMockOllamaClient({
      listResponse: {
        models: [
          {
            name: "llama3.1",
            modified_at: new Date(),
            size: 1000000,
            digest: "sha256:test",
            details: {
              family: "llama",
              parameter_size: "8B",
              quantization_level: "Q4_0",
            },
          },
        ],
      },
    });

    client["client"] = mockClient as unknown as typeof client["client"];
    client["isConfigured"] = true;

    const exists = await client.ensureModelExists("llama3.1");
    assertEquals(exists, true);
  });

  await t.step(
    "should ensure model exists - model not present, pull successful",
    async () => {
      const client = new RuntOllamaClient();
      const mockClient = createMockOllamaClient({
        listResponse: {
          models: [], // No models available
        },
        pullResponse: {
          status: "success",
        },
      });

      client["client"] = mockClient as unknown as typeof client["client"];
      client["isConfigured"] = true;

      const exists = await client.ensureModelExists("mistral");
      assertEquals(exists, true);
    },
  );

  await t.step(
    "should ensure model exists - model not present, pull failed",
    async () => {
      const client = new RuntOllamaClient();
      const mockClient = createMockOllamaClient({
        listResponse: {
          models: [], // No models available
        },
        pullResponse: {
          status: "failed",
        },
      });

      client["client"] = mockClient as unknown as typeof client["client"];
      client["isConfigured"] = true;

      const exists = await client.ensureModelExists("nonexistent");
      assertEquals(exists, false);
    },
  );
});

Deno.test("Ollama Client - Connection Status", async (t) => {
  await t.step("should be ready when server is available", async () => {
    const client = new RuntOllamaClient();
    const mockClient = createMockOllamaClient();

    client["client"] = mockClient as unknown as typeof client["client"];
    client["isConfigured"] = true;

    const ready = await client.isReady();
    assertEquals(ready, true);
  });

  await t.step("should not be ready when server is unavailable", async () => {
    const client = new RuntOllamaClient();
    const mockClient = createMockOllamaClient({
      shouldFailList: true,
    });

    client["client"] = mockClient as unknown as typeof client["client"];
    client["isConfigured"] = true;

    const ready = await client.isReady();
    assertEquals(ready, false);
  });
});

Deno.test("Ollama Client - Streaming Chat", async (t) => {
  await t.step("should stream markdown content token by token", async () => {
    const client = new RuntOllamaClient();
    const { context, outputs, getMarkdownContent } =
      createMockExecutionContext();

    const mockClient = createMockOllamaClient({
      chatResponse: new MockOllamaStreamingResponse([
        {
          message: { role: "assistant", content: "Hello" },
          done: false,
        },
        {
          message: { role: "assistant", content: " world" },
          done: false,
        },
        {
          message: { role: "assistant", content: "!" },
          done: false,
        },
        {
          message: { role: "assistant", content: "\n\nThis is" },
          done: false,
        },
        {
          message: { role: "assistant", content: " a test." },
          done: true,
        },
      ]),
    });

    client["client"] = mockClient as unknown as typeof client["client"];
    client["isConfigured"] = true;

    const messages = [
      { role: "user" as const, content: "Hello!" },
    ];

    await client.generateAgenticResponse(messages, context, {
      model: "llama3.1",
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
    assertEquals(metadata.anode.ai_provider, "ollama");
    assertEquals(metadata.anode.ai_model, "llama3.1");
  });

  await t.step("should handle tool calls", async () => {
    const client = new RuntOllamaClient();
    const { context, outputs } = createMockExecutionContext();

    const mockClient = createMockOllamaClient({
      chatResponse: new MockOllamaStreamingResponse([
        {
          message: {
            role: "assistant",
            content: "I'll create a cell for you.",
            tool_calls: [
              {
                function: {
                  name: "create_cell",
                  arguments: { cellType: "code", content: "print('hello')" },
                },
              },
            ],
          },
          done: true,
        },
      ]),
    });

    client["client"] = mockClient as unknown as typeof client["client"];
    client["isConfigured"] = true;

    const messages = [
      { role: "user" as const, content: "Create a code cell" },
    ];

    let toolCallReceived = false;
    const mockToolCall = (
      toolCall: { name: string; arguments: Record<string, unknown> },
    ) => {
      assertEquals(toolCall.name, "create_cell");
      assertEquals(toolCall.arguments.cellType, "code");
      toolCallReceived = true;
      return Promise.resolve("Cell created successfully");
    };

    await client.generateAgenticResponse(messages, context, {
      model: "llama3.1",
      enableTools: true,
      onToolCall: mockToolCall,
      maxIterations: 1,
    });

    // Should have processed tool call
    assertEquals(toolCallReceived, true);

    // Should have markdown output for the content
    const markdownOutputs = outputs.filter((o) => o.type === "markdown");
    assertEquals(markdownOutputs.length, 1);

    // Should have display outputs for tool execution
    const displayOutputs = outputs.filter((o) => o.type === "display");
    assertEquals(displayOutputs.length >= 1, true);
  });

  await t.step("should handle server not ready", async () => {
    const client = new RuntOllamaClient();
    const { context, outputs } = createMockExecutionContext();

    const mockClient = createMockOllamaClient({
      shouldFailList: true,
    });

    client["client"] = mockClient as unknown as typeof client["client"];
    client["isConfigured"] = true;

    const messages = [
      { role: "user" as const, content: "Hello!" },
    ];

    await client.generateAgenticResponse(messages, context, {
      model: "llama3.1",
    });

    // Should display configuration help
    const displayOutputs = outputs.filter((o) => o.type === "display");
    assertEquals(displayOutputs.length >= 1, true);

    const helpOutput = displayOutputs[0].data as { "text/markdown": string };
    assertEquals(
      helpOutput["text/markdown"].includes("Ollama Configuration"),
      true,
    );
  });

  await t.step("should handle model not available", async () => {
    const client = new RuntOllamaClient();
    const { context, outputs } = createMockExecutionContext();

    const mockClient = createMockOllamaClient({
      listResponse: {
        models: [], // No models available
      },
      pullResponse: {
        status: "failed", // Pull fails
      },
    });

    client["client"] = mockClient as unknown as typeof client["client"];
    client["isConfigured"] = true;

    const messages = [
      { role: "user" as const, content: "Hello!" },
    ];

    await client.generateAgenticResponse(messages, context, {
      model: "nonexistent",
    });

    // Should display error about model not being available
    const _displayOutputs = outputs.filter((o) => o.type === "display");
    const errorOutputs = outputs.filter((o) => o.type === "error");

    // The error should be displayed as error type
    assertEquals(errorOutputs.length >= 1, true);
  });

  await t.step("should handle chat API error", async () => {
    const client = new RuntOllamaClient();
    const { context, outputs } = createMockExecutionContext();

    const mockClient = createMockOllamaClient({
      shouldFailChat: true,
    });

    client["client"] = mockClient as unknown as typeof client["client"];
    client["isConfigured"] = true;

    const messages = [
      { role: "user" as const, content: "Hello!" },
    ];

    await client.generateAgenticResponse(messages, context, {
      model: "llama3.1",
    });

    // Should display error output
    const _displayOutputs = outputs.filter((o) => o.type === "display");
    const errorOutputs = outputs.filter((o) => o.type === "error");

    // The error should be displayed as error type
    assertEquals(errorOutputs.length >= 1, true);
  });

  await t.step("should respect max iterations", async () => {
    const client = new RuntOllamaClient();
    const { context, outputs } = createMockExecutionContext();

    const mockClient = createMockOllamaClient({
      chatResponse: new MockOllamaStreamingResponse([
        {
          message: {
            role: "assistant",
            content: "I'll keep calling tools.",
            tool_calls: [
              {
                function: {
                  name: "create_cell",
                  arguments: { cellType: "code", content: "print('hello')" },
                },
              },
            ],
          },
          done: true,
        },
      ]),
    });

    client["client"] = mockClient as unknown as typeof client["client"];
    client["isConfigured"] = true;

    const messages = [
      { role: "user" as const, content: "Create many cells" },
    ];

    let toolCallCount = 0;
    const mockToolCall = () => {
      toolCallCount++;
      return Promise.resolve("Cell created successfully");
    };

    await client.generateAgenticResponse(messages, context, {
      model: "llama3.1",
      enableTools: true,
      onToolCall: mockToolCall,
      maxIterations: 2,
    });

    // Should have stopped at max iterations
    assertEquals(toolCallCount <= 2, true);

    // Should display max iterations warning
    const displayOutputs = outputs.filter((o) => o.type === "display");
    const maxIterationsOutput = displayOutputs.find(
      (o) =>
        (o.data as { "text/markdown": string })["text/markdown"]?.includes(
          "maximum iterations",
        ),
    );
    assertEquals(maxIterationsOutput !== undefined, true);
  });

  await t.step("should handle tool call errors", async () => {
    const client = new RuntOllamaClient();
    const { context, outputs } = createMockExecutionContext();

    const mockClient = createMockOllamaClient({
      chatResponse: new MockOllamaStreamingResponse([
        {
          message: {
            role: "assistant",
            content: "I'll try to create a cell.",
            tool_calls: [
              {
                function: {
                  name: "create_cell",
                  arguments: { cellType: "code", content: "print('hello')" },
                },
              },
            ],
          },
          done: true,
        },
      ]),
    });

    client["client"] = mockClient as unknown as typeof client["client"];
    client["isConfigured"] = true;

    const messages = [
      { role: "user" as const, content: "Create a cell" },
    ];

    const mockToolCall = () => {
      throw new Error("Tool execution failed");
    };

    await client.generateAgenticResponse(messages, context, {
      model: "llama3.1",
      enableTools: true,
      onToolCall: mockToolCall,
      maxIterations: 1,
    });

    // Should display error output for tool failure
    const displayOutputs = outputs.filter((o) => o.type === "display");
    const errorOutput = displayOutputs.find(
      (o) =>
        (o.data as { "text/markdown": string })["text/markdown"]?.includes(
          "Tool failed",
        ),
    );
    assertEquals(errorOutput !== undefined, true);
  });
});

Deno.test("Ollama Client - Interruption Support", async (t) => {
  await t.step("should respect abort signal", async () => {
    const client = new RuntOllamaClient();
    const { context } = createMockExecutionContext();

    const mockClient = createMockOllamaClient({
      chatResponse: new MockOllamaStreamingResponse([
        {
          message: { role: "assistant", content: "This should be interrupted" },
          done: true,
        },
      ]),
    });

    client["client"] = mockClient as unknown as typeof client["client"];
    client["isConfigured"] = true;

    const messages = [
      { role: "user" as const, content: "Hello!" },
    ];

    const abortController = new AbortController();
    abortController.abort(); // Abort immediately

    await client.generateAgenticResponse(messages, context, {
      model: "llama3.1",
      enableTools: false,
      interruptSignal: abortController.signal,
    });

    // The conversation should be interrupted and not process any content
    // This is a basic test - in practice, the interruption would happen during streaming
  });
});

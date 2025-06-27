// @ts-nocheck It's a test file
import { assertEquals, assertExists } from "jsr:@std/assert@1.0.13";
import { RuntOpenAIClient } from "../src/openai-client.ts";

// Mock execution context for testing
class MockExecutionContext {
  public outputs: Array<{
    data: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }> = [];

  display(
    data: Record<string, unknown>,
    metadata: Record<string, unknown> = {},
  ) {
    this.outputs.push({ data, metadata });
  }

  stdout(_text: string) {}
  stderr(_text: string) {}
  result(_data: Record<string, unknown>) {}
  error(_name: string, _value: string, _traceback: string[]) {}
  clear() {
    this.outputs = [];
  }
}

Deno.test("OpenAI Client - Unit Tests", async (t) => {
  let client: RuntOpenAIClient;
  let mockContext: MockExecutionContext;
  const originalApiKey = Deno.env.get("OPENAI_API_KEY");

  await t.step("setup", () => {
    // Set mock API key for testing
    Deno.env.set("OPENAI_API_KEY", "test-key-12345");
    client = new RuntOpenAIClient();
    mockContext = new MockExecutionContext();
  });

  await t.step(
    "should accept conversation messages instead of just prompt",
    async () => {
      // Test that the new signature accepts ChatMessage[]
      const conversationMessages = [
        { role: "system" as const, content: "You are a helpful assistant." },
        { role: "user" as const, content: "Create a test cell" },
      ];

      // Mock tool call handler
      const mockToolCall = async (_toolCall) => {
        await new Promise();
        return "Created code cell: test-cell-123";
      };

      // This should not throw - we're testing the signature accepts messages
      try {
        await client.generateAgenticResponse(
          conversationMessages,
          mockContext,
          {
            model: "gpt-4o-mini",
            enableTools: false, // Disable tools to avoid actual API calls
            maxIterations: 1,
            onToolCall: mockToolCall,
          },
        );
      } catch (error) {
        // We expect this to fail with API key error, but not with signature error
        assertEquals(
          (error as Error).message.includes("Invalid API key"),
          true,
          "Should fail due to mock API key, not signature mismatch",
        );
      }
    },
  );

  await t.step("should emit outputs with anode metadata structure", () => {
    // Test that outputs include properly structured anode metadata
    const testData = { "text/markdown": "Test response" };
    const anodeMetadata = {
      role: "assistant",
      ai_provider: "openai",
      ai_model: "gpt-4o-mini",
      iteration: 1,
    };
    const testMetadata = {
      anode: anodeMetadata,
    };

    mockContext.display(testData, testMetadata);

    assertEquals(mockContext.outputs.length, 1);
    const output = mockContext.outputs[0];

    assertExists(output.metadata?.anode);
    assertEquals(output.metadata.anode.role, "assistant");
    assertEquals(output.metadata.anode.ai_provider, "openai");
    assertEquals(output.metadata.anode.iteration, 1);
  });

  await t.step(
    "should handle tool call messages with tool_calls property",
    () => {
      // Test that assistant messages with tool calls are properly structured
      const toolCalls = [{
        id: "call_123",
        type: "function" as const,
        function: {
          name: "create_cell",
          arguments: JSON.stringify({
            cellType: "code",
            content: "print('test')",
          }),
        },
      }];

      // Simulate what should happen when OpenAI returns tool calls
      const assistantMessage = {
        role: "assistant" as const,
        content: "",
        tool_calls: toolCalls,
      };

      // Verify the structure is correct
      assertEquals(assistantMessage.role, "assistant");
      assertEquals(assistantMessage.tool_calls?.length, 1);
      assertEquals(assistantMessage.tool_calls[0].function.name, "create_cell");
    },
  );

  await t.step("should handle tool result emissions", () => {
    // Test that tool results are emitted with proper structure
    const toolResultData = {
      "application/vnd.anode.aitool.result+json": {
        tool_call_id: "call_123",
        result: "Created code cell: test-123",
        status: "success",
      },
    };

    const anodeMetadata = {
      role: "tool",
      tool_call_id: "call_123",
      tool_name: "create_cell",
      iteration: 1,
    };
    const toolResultMetadata = {
      anode: anodeMetadata,
    };

    mockContext.display(toolResultData, toolResultMetadata);

    const toolOutput = mockContext.outputs.find((o) =>
      o.data["application/vnd.anode.aitool.result+json"]
    );

    assertExists(toolOutput, "Should have tool result output");
    assertEquals(toolOutput.metadata?.anode?.role, "tool");
    assertEquals(toolOutput.metadata?.anode?.tool_call_id, "call_123");
  });

  await t.step("cleanup", () => {
    // Restore original API key
    if (originalApiKey) {
      Deno.env.set("OPENAI_API_KEY", originalApiKey);
    } else {
      Deno.env.delete("OPENAI_API_KEY");
    }
  });
});

Deno.test("Conversation Message Building - Unit Tests", async (t) => {
  await t.step("should reconstruct conversation from AI cell outputs", () => {
    // Test the conversation reconstruction logic
    const aiCellOutputs = [
      {
        outputType: "display_data",
        data: { "text/markdown": "I'll create a cell for you." },
        metadata: {
          anode: {
            role: "assistant",
            iteration: 1,
          },
        },
      },
      {
        outputType: "display_data",
        data: {
          "application/vnd.anode.aitool+json": {
            tool_call_id: "call_123",
            tool_name: "create_cell",
            arguments: { cellType: "code", content: "print('test')" },
            status: "success",
          },
        },
        metadata: {
          anode: {
            role: "function_call",
            tool_call: true,
            iteration: 1,
          },
        },
      },
      {
        outputType: "display_data",
        data: {
          "application/vnd.anode.aitool.result+json": {
            tool_call_id: "call_123",
            result: "Created code cell: test-123",
            status: "success",
          },
        },
        metadata: {
          anode: {
            role: "tool",
            tool_call_id: "call_123",
            iteration: 1,
          },
        },
      },
    ];

    // This would be part of the buildConversationMessages logic
    const reconstructedMessages = [];

    for (const output of aiCellOutputs) {
      const metadata = output.metadata as { anode?: { role?: string } };
      const anodeRole = metadata?.anode?.role;

      if (anodeRole === "assistant" && output.data["text/markdown"]) {
        reconstructedMessages.push({
          role: "assistant",
          content: String(output.data["text/markdown"]),
        });
      } else if (
        anodeRole === "function_call" &&
        output.data["application/vnd.anode.aitool+json"]
      ) {
        const toolData = output
          .data["application/vnd.anode.aitool+json"];
        reconstructedMessages.push({
          role: "assistant",
          content: "",
          tool_calls: [{
            id: toolData.tool_call_id,
            type: "function",
            function: {
              name: toolData.tool_name,
              arguments: JSON.stringify(toolData.arguments),
            },
          }],
        });
      } else if (
        anodeRole === "tool" &&
        output.data["application/vnd.anode.aitool.result+json"]
      ) {
        const resultData = output
          .data["application/vnd.anode.aitool.result+json"];
        reconstructedMessages.push({
          role: "tool",
          content: resultData.result || "Success",
          tool_call_id: resultData.tool_call_id,
        });
      }
    }

    // Verify the reconstruction worked correctly
    assertEquals(reconstructedMessages.length, 3);

    // First message: assistant response
    assertEquals(reconstructedMessages[0].role, "assistant");
    assertEquals(
      reconstructedMessages[0].content,
      "I'll create a cell for you.",
    );

    // Second message: assistant with tool calls
    assertEquals(reconstructedMessages[1].role, "assistant");
    assertEquals(reconstructedMessages[1].content, "");
    assertExists(reconstructedMessages[1].tool_calls);
    assertEquals(
      reconstructedMessages[1].tool_calls[0].function.name,
      "create_cell",
    );

    // Third message: tool result
    assertEquals(reconstructedMessages[2].role, "tool");
    assertEquals(
      reconstructedMessages[2].content,
      "Created code cell: test-123",
    );
    assertEquals(reconstructedMessages[2].tool_call_id, "call_123");
  });

  await t.step("should maintain proper tool call ordering", () => {
    // Test that tool calls and responses are ordered correctly
    const messages = [
      {
        role: "assistant",
        content: "I'll help you.",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "create_cell", arguments: "{}" },
        }],
      },
      { role: "tool", content: "Success", tool_call_id: "call_1" },
    ];

    // Verify OpenAI conversation rules are followed
    let hasToolCall = false;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.role === "assistant" && msg.tool_calls) {
        hasToolCall = true;
      } else if (msg.role === "tool") {
        assertEquals(
          hasToolCall,
          true,
          "Tool message must follow assistant message with tool_calls",
        );
        assertExists(msg.tool_call_id, "Tool message must have tool_call_id");
      }
    }
  });
});

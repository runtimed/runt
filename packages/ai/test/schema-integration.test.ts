/**
 * Tests for schema constants integration in AI package
 */

import { assertEquals } from "jsr:@std/assert";
import {
  AI_TOOL_CALL_MIME_TYPE,
  AI_TOOL_RESULT_MIME_TYPE,
  type AiToolCallData,
  type AiToolResultData,
  isAiToolCallData,
  isAiToolMimeType,
  isAiToolResultData,
} from "@runt/schema";
import { buildConversationMessages, type NotebookContextData } from "../mod.ts";

Deno.test("Schema Integration - AI Tool Constants", async (t) => {
  await t.step("should have correct AI tool MIME types", () => {
    assertEquals(AI_TOOL_CALL_MIME_TYPE, "application/vnd.anode.aitool+json");
    assertEquals(
      AI_TOOL_RESULT_MIME_TYPE,
      "application/vnd.anode.aitool.result+json",
    );
  });

  await t.step("should identify AI tool MIME types", () => {
    assertEquals(isAiToolMimeType(AI_TOOL_CALL_MIME_TYPE), true);
    assertEquals(isAiToolMimeType(AI_TOOL_RESULT_MIME_TYPE), true);
    assertEquals(isAiToolMimeType("application/json"), false);
    assertEquals(isAiToolMimeType("text/plain"), false);
  });

  await t.step("should validate AI tool call data", () => {
    const validToolCall: AiToolCallData = {
      tool_call_id: "call_123",
      tool_name: "create_cell",
      arguments: { cellType: "code", content: "print('hello')" },
    };

    assertEquals(isAiToolCallData(validToolCall), true);
    assertEquals(isAiToolCallData({}), false);
    assertEquals(isAiToolCallData({ tool_call_id: "123" }), false);
    assertEquals(isAiToolCallData(null), false);
  });

  await t.step("should validate AI tool result data", () => {
    const validToolResult: AiToolResultData = {
      tool_call_id: "call_123",
      tool_name: "create_cell",
      arguments: { cellType: "code", content: "print('hello')" },
      status: "success",
      timestamp: "2025-01-11T00:00:00Z",
      result: "Created cell successfully",
    };

    assertEquals(isAiToolResultData(validToolResult), true);
    assertEquals(isAiToolResultData({}), false);
    assertEquals(isAiToolResultData({ status: "invalid" }), false);
    assertEquals(isAiToolResultData(null), false);
  });
});

Deno.test("Schema Integration - Conversation Building", async (t) => {
  await t.step("should use schema constants in conversation building", () => {
    const context: NotebookContextData = {
      previousCells: [
        {
          id: "cell-1",
          cellType: "ai",
          source: "Create a code cell",
          position: 1,
          outputs: [
            {
              outputType: "display_data",
              data: {
                [AI_TOOL_CALL_MIME_TYPE]: {
                  tool_call_id: "call_456",
                  tool_name: "create_cell",
                  arguments: {
                    cellType: "code",
                    content: "import numpy as np",
                  },
                } as AiToolCallData,
              },
              metadata: { anode: { role: "function_call" } },
            },
            {
              outputType: "display_data",
              data: {
                [AI_TOOL_RESULT_MIME_TYPE]: {
                  tool_call_id: "call_456",
                  tool_name: "create_cell",
                  arguments: {
                    cellType: "code",
                    content: "import numpy as np",
                  },
                  status: "success",
                  timestamp: "2025-01-11T00:00:00Z",
                  result: "Created code cell: cell-789",
                } as AiToolResultData,
              },
              metadata: { anode: { role: "tool" } },
            },
          ],
        },
      ],
      totalCells: 1,
      currentCellPosition: 1,
    };

    const messages = buildConversationMessages(
      context,
      "You are a helpful assistant.",
      "What did you create?",
    );

    // Should have: system, assistant (tool call), tool (result), user (prompt)
    assertEquals(messages.length, 4);
    assertEquals(messages[0].role, "system");
    assertEquals(messages[1].role, "assistant");
    assertEquals(messages[2].role, "tool");
    assertEquals(messages[3].role, "user");

    // Check tool call message
    const toolCallMessage = messages[1] as {
      role: string;
      content: string;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
    assertEquals(toolCallMessage.tool_calls?.length, 1);
    assertEquals(toolCallMessage.tool_calls?.[0].function.name, "create_cell");
    assertEquals(toolCallMessage.tool_calls?.[0].id, "call_456");

    // Check tool result message
    const toolResultMessage = messages[2] as {
      role: string;
      content: string;
      tool_call_id: string;
    };
    assertEquals(toolResultMessage.tool_call_id, "call_456");
    assertEquals(toolResultMessage.content, "Created code cell: cell-789");
  });

  await t.step("should handle malformed tool data gracefully", () => {
    const context: NotebookContextData = {
      previousCells: [
        {
          id: "cell-1",
          cellType: "ai",
          source: "Create a code cell",
          position: 1,
          outputs: [
            {
              outputType: "display_data",
              data: {
                [AI_TOOL_CALL_MIME_TYPE]: {
                  // Missing required fields
                  tool_call_id: "call_invalid",
                },
              },
              metadata: { anode: { role: "function_call" } },
            },
          ],
        },
      ],
      totalCells: 1,
      currentCellPosition: 1,
    };

    const messages = buildConversationMessages(
      context,
      "You are a helpful assistant.",
      "What happened?",
    );

    // Should have system, assistant (with malformed tool call), and user messages
    assertEquals(messages.length, 3);
    assertEquals(messages[0].role, "system");
    assertEquals(messages[1].role, "assistant");
    assertEquals(messages[2].role, "user");

    // The malformed tool call should still create a message but with undefined values
    const toolCallMessage = messages[1] as {
      role: string;
      content: string;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
    assertEquals(toolCallMessage.tool_calls?.length, 1);
    assertEquals(toolCallMessage.tool_calls?.[0].id, "call_invalid");
    assertEquals(toolCallMessage.tool_calls?.[0].function.name, undefined);
  });
});

Deno.test("Schema Integration - Type Safety", async (t) => {
  await t.step("should enforce type safety for tool call data", () => {
    // This should compile without errors
    const toolCallData: AiToolCallData = {
      tool_call_id: "call_123",
      tool_name: "execute_cell",
      arguments: { cellId: "cell-456" },
    };

    // Verify the data structure
    assertEquals(typeof toolCallData.tool_call_id, "string");
    assertEquals(typeof toolCallData.tool_name, "string");
    assertEquals(typeof toolCallData.arguments, "object");
  });

  await t.step("should enforce type safety for tool result data", () => {
    // This should compile without errors
    const toolResultData: AiToolResultData = {
      tool_call_id: "call_123",
      tool_name: "execute_cell",
      arguments: { cellId: "cell-456" },
      status: "success",
      timestamp: "2025-01-11T00:00:00Z",
      result: "Execution completed successfully",
    };

    // Verify the data structure
    assertEquals(typeof toolResultData.tool_call_id, "string");
    assertEquals(typeof toolResultData.tool_name, "string");
    assertEquals(typeof toolResultData.arguments, "object");
    assertEquals(
      toolResultData.status === "success" || toolResultData.status === "error",
      true,
    );
    assertEquals(typeof toolResultData.timestamp, "string");
    assertEquals(typeof toolResultData.result, "string");
  });

  await t.step("should provide consistent MIME type constants", () => {
    // These constants should be available and consistent
    const toolCallMimeType = AI_TOOL_CALL_MIME_TYPE;
    const toolResultMimeType = AI_TOOL_RESULT_MIME_TYPE;

    assertEquals(typeof toolCallMimeType, "string");
    assertEquals(typeof toolResultMimeType, "string");
    assertEquals(toolCallMimeType.includes("aitool"), true);
    assertEquals(toolResultMimeType.includes("aitool.result"), true);
  });
});

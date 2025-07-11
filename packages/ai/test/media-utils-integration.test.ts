/**
 * Tests for AI media utilities integration with conversation building
 */

import { assertEquals } from "jsr:@std/assert";
import {
  buildConversationMessages,
  toAIContext,
  toAIMediaBundle,
} from "../mod.ts";
import type { NotebookContextData } from "../mod.ts";

Deno.test("AI Media Utils Integration", async (t) => {
  await t.step("toAIMediaBundle should prioritize markdown over HTML", () => {
    const richOutput = {
      "text/html": {
        type: "inline" as const,
        data: "<h1>Sales Report</h1><p>Revenue: $10,000</p>",
      },
      "text/markdown": {
        type: "inline" as const,
        data: "# Sales Report\n\nRevenue: $10,000",
      },
      "text/plain": {
        type: "inline" as const,
        data: "Sales Report\nRevenue: $10,000",
      },
    };

    const result = toAIMediaBundle(richOutput);

    assertEquals(result["text/markdown"], "# Sales Report\n\nRevenue: $10,000");
    assertEquals(result["text/plain"], "Sales Report\nRevenue: $10,000");
    // HTML should not be included when markdown is available
    assertEquals(result["text/html"], undefined);
  });

  await t.step("toAIContext should return markdown when available", () => {
    const richOutput = {
      "text/html": {
        type: "inline" as const,
        data: "<h1>Test</h1>",
      },
      "text/markdown": {
        type: "inline" as const,
        data: "# Test",
      },
      "text/plain": {
        type: "inline" as const,
        data: "Test",
      },
    };

    const result = toAIContext(richOutput);
    assertEquals(result, "# Test");
  });

  await t.step("toAIContext should fallback to plain text", () => {
    const richOutput = {
      "text/html": {
        type: "inline" as const,
        data: "<h1>Test</h1>",
      },
      "text/plain": {
        type: "inline" as const,
        data: "Test",
      },
    };

    const result = toAIContext(richOutput);
    assertEquals(result, "Test");
  });

  await t.step("conversation building should use AI media utilities", () => {
    const context: NotebookContextData = {
      previousCells: [
        {
          id: "cell-1",
          cellType: "code",
          source: "print('Hello')",
          position: 1,
          outputs: [
            {
              outputType: "multimedia_result",
              data: {},
              metadata: {},
              representations: {
                "text/markdown": {
                  type: "inline" as const,
                  data: "**Hello World**",
                },
                "text/plain": {
                  type: "inline" as const,
                  data: "Hello World",
                },
              },
            },
          ],
        },
      ],
      totalCells: 2,
      currentCellPosition: 2,
    };

    const messages = buildConversationMessages(
      context,
      "You are a helpful assistant.",
      "What was the output?",
    );

    // Find the user message with the code cell
    const codeMessage = messages.find(
      (msg) =>
        msg.role === "user" && typeof msg.content === "string" &&
        msg.content.includes("cell-1"),
    );

    // Should include the markdown output processed by AI media utilities
    assertEquals(codeMessage !== undefined, true);
    assertEquals(
      typeof codeMessage?.content === "string" &&
        codeMessage.content.includes("**Hello World**"),
      true,
    );
  });

  await t.step(
    "conversation building should handle missing representations",
    () => {
      const context: NotebookContextData = {
        previousCells: [
          {
            id: "cell-1",
            cellType: "code",
            source: "print('Hello')",
            position: 1,
            outputs: [
              {
                outputType: "multimedia_result",
                data: {},
                metadata: {},
                // No representations property
              },
            ],
          },
        ],
        totalCells: 2,
        currentCellPosition: 2,
      };

      const messages = buildConversationMessages(
        context,
        "You are a helpful assistant.",
        "What was the output?",
      );

      // Should not crash and should create valid messages
      assertEquals(messages.length, 3); // system, user (code cell), user (prompt)
      assertEquals(messages[0].role, "system");
      assertEquals(messages[1].role, "user");
      assertEquals(messages[2].role, "user");
    },
  );

  await t.step(
    "conversation building should handle empty representations",
    () => {
      const context: NotebookContextData = {
        previousCells: [
          {
            id: "cell-1",
            cellType: "code",
            source: "print('Hello')",
            position: 1,
            outputs: [
              {
                outputType: "multimedia_result",
                data: {},
                metadata: {},
                representations: {}, // Empty representations
              },
            ],
          },
        ],
        totalCells: 2,
        currentCellPosition: 2,
      };

      const messages = buildConversationMessages(
        context,
        "You are a helpful assistant.",
        "What was the output?",
      );

      // Should not crash and should create valid messages
      assertEquals(messages.length, 3);
      const codeMessage = messages.find(
        (msg) =>
          msg.role === "user" && typeof msg.content === "string" &&
          msg.content.includes("cell-1"),
      );
      assertEquals(codeMessage !== undefined, true);
    },
  );
});

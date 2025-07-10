import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { RuntOpenAIClient } from "../openai-client.ts";

Deno.test("OpenAI Model Compatibility", async (t) => {
  const client = new RuntOpenAIClient();

  await t.step("should identify models that use max_completion_tokens", () => {
    // Test private method via reflection
    const usesMaxCompletionTokens = (client as unknown as {
      usesMaxCompletionTokens: (model: string) => boolean;
    }).usesMaxCompletionTokens;

    // Models that should use max_completion_tokens
    assertEquals(usesMaxCompletionTokens("o1-preview"), true);
    assertEquals(usesMaxCompletionTokens("o1-mini"), true);
    assertEquals(usesMaxCompletionTokens("o3-mini"), true);
    assertEquals(usesMaxCompletionTokens("o4-mini"), true);

    // Models that should use max_tokens
    assertEquals(usesMaxCompletionTokens("gpt-4o"), false);
    assertEquals(usesMaxCompletionTokens("gpt-4o-mini"), false);
    assertEquals(usesMaxCompletionTokens("gpt-4.1"), false);
    assertEquals(usesMaxCompletionTokens("gpt-3.5-turbo"), false);
  });

  await t.step("should identify models that support system messages", () => {
    // Test private method via reflection
    const supportsSystemMessages = (client as unknown as {
      supportsSystemMessages: (model: string) => boolean;
    }).supportsSystemMessages;

    // Models that don't support system messages
    assertEquals(supportsSystemMessages("o1-preview"), false);
    assertEquals(supportsSystemMessages("o1-mini"), false);
    assertEquals(supportsSystemMessages("o1-pro"), false);

    // Models that support system messages
    assertEquals(supportsSystemMessages("gpt-4o"), true);
    assertEquals(supportsSystemMessages("gpt-4o-mini"), true);
    assertEquals(supportsSystemMessages("gpt-4.1"), true);
    assertEquals(supportsSystemMessages("o3-mini"), true);
    assertEquals(supportsSystemMessages("o4-mini"), true);
  });

  await t.step("should identify models that support custom temperature", () => {
    // Test private method via reflection
    const supportsCustomTemperature = (client as unknown as {
      supportsCustomTemperature: (model: string) => boolean;
    }).supportsCustomTemperature;

    // All reasoning models (o1, o3, o4) don't support custom temperature
    assertEquals(supportsCustomTemperature("o1-preview"), false);
    assertEquals(supportsCustomTemperature("o1-mini"), false);
    assertEquals(supportsCustomTemperature("o3-mini"), false);
    assertEquals(supportsCustomTemperature("o3"), false);
    assertEquals(supportsCustomTemperature("o4-mini"), false);

    // Non-reasoning models support custom temperature
    assertEquals(supportsCustomTemperature("gpt-4o"), true);
    assertEquals(supportsCustomTemperature("gpt-4o-mini"), true);
    assertEquals(supportsCustomTemperature("gpt-4.1"), true);
  });

  await t.step("should identify reasoning models", () => {
    // Test private method via reflection
    const isReasoningModel = (client as unknown as {
      isReasoningModel: (model: string) => boolean;
    }).isReasoningModel;

    // Reasoning models (start with o)
    assertEquals(isReasoningModel("o1-preview"), true);
    assertEquals(isReasoningModel("o1-mini"), true);
    assertEquals(isReasoningModel("o3-mini"), true);
    assertEquals(isReasoningModel("o3"), true);
    assertEquals(isReasoningModel("o4-mini"), true);

    // Non-reasoning models
    assertEquals(isReasoningModel("gpt-4o"), false);
    assertEquals(isReasoningModel("gpt-4o-mini"), false);
    assertEquals(isReasoningModel("gpt-4.1"), false);
  });

  await t.step(
    "should filter messages for models without system support",
    () => {
      // Test private method via reflection with proper binding
      const filterMessagesForModel = (client as unknown as {
        filterMessagesForModel: (
          messages: { role: string; content: string }[],
          model: string,
        ) => { role: string; content: string }[];
      }).filterMessagesForModel
        .bind(client);

      const messages = [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello!" },
        { role: "assistant", content: "Hi there!" },
      ];

      // For models that support system messages, should return unchanged
      const gpt4oMessages = filterMessagesForModel(messages, "gpt-4o");
      assertEquals(gpt4oMessages.length, 3);
      assertEquals(gpt4oMessages[0].role, "system");
      assertEquals(gpt4oMessages[0].content, "You are a helpful assistant.");

      // For models that don't support system messages, should convert system to user
      const o1Messages = filterMessagesForModel(messages, "o1-preview");
      assertEquals(o1Messages.length, 3);
      assertEquals(o1Messages[0].role, "user");
      assertEquals(
        o1Messages[0].content,
        "System instructions: You are a helpful assistant.",
      );
      assertEquals(o1Messages[1].role, "user");
      assertEquals(o1Messages[1].content, "Hello!");
      assertEquals(o1Messages[2].role, "assistant");
      assertEquals(o1Messages[2].content, "Hi there!");
    },
  );

  await t.step("should handle empty messages array", () => {
    const filterMessagesForModel = (client as unknown as {
      filterMessagesForModel: (
        messages: { role: string; content: string }[],
        model: string,
      ) => { role: string; content: string }[];
    }).filterMessagesForModel.bind(
      client,
    );

    const emptyMessages: { role: string; content: string }[] = [];
    const result = filterMessagesForModel(emptyMessages, "o1-preview");
    assertEquals(result.length, 0);
  });

  await t.step("should handle messages without system role", () => {
    const filterMessagesForModel = (client as unknown as {
      filterMessagesForModel: (
        messages: { role: string; content: string }[],
        model: string,
      ) => { role: string; content: string }[];
    }).filterMessagesForModel.bind(
      client,
    );

    const messages = [
      { role: "user", content: "Hello!" },
      { role: "assistant", content: "Hi there!" },
    ];

    const result = filterMessagesForModel(messages, "o1-preview");
    assertEquals(result.length, 2);
    assertEquals(result[0].role, "user");
    assertEquals(result[0].content, "Hello!");
    assertEquals(result[1].role, "assistant");
    assertEquals(result[1].content, "Hi there!");
  });
});

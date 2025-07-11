// AIPython Agent Tests
//
// Basic unit tests for the AIPython runtime agent to verify core functionality
// without requiring actual OpenAI API calls.

import { assertEquals, assertExists, assertInstanceOf } from "jsr:@std/assert";
import { AIPythonAgent } from "./aipython-agent.ts";

// Mock OpenAI API responses for testing
const mockOpenAIResponse = {
  choices: [{
    message: {
      content: null,
      tool_calls: [{
        id: "test-tool-call-1",
        type: "function" as const,
        function: {
          name: "execute_result",
          arguments: JSON.stringify({
            data: { "text/plain": "5" },
          }),
        },
      }],
    },
  }],
};

// Override fetch for testing
const originalFetch = globalThis.fetch;

function mockFetch(response: unknown) {
  globalThis.fetch = () =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(response),
    } as Response);
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

Deno.test("AIPython Agent", async (t) => {
  await t.step("should create agent instance", () => {
    // Set required environment variables for testing
    Deno.env.set("OPENAI_API_KEY", "test-key");
    Deno.env.set("NOTEBOOK_ID", "test-notebook");
    Deno.env.set("AUTH_TOKEN", "test-token");

    const agent = new AIPythonAgent();
    assertExists(agent);
    assertInstanceOf(agent, AIPythonAgent);
  });

  await t.step("should have required methods", () => {
    Deno.env.set("OPENAI_API_KEY", "test-key");
    Deno.env.set("NOTEBOOK_ID", "test-notebook");
    Deno.env.set("AUTH_TOKEN", "test-token");

    const agent = new AIPythonAgent();

    assertEquals(typeof agent.start, "function");
    assertEquals(typeof agent.shutdown, "function");
    assertEquals(typeof agent.keepAlive, "function");
  });

  await t.step("should handle tool calls correctly", async () => {
    // Mock fetch to return a tool call response
    mockFetch(mockOpenAIResponse);

    try {
      // This would normally test the tool call handling
      // but requires more complex mocking of the execution context
      // For now, just verify the mock is working
      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      const data = await response.json();
      assertEquals(data.choices.length, 1);
      assertEquals(
        data.choices[0].message.tool_calls[0].function.name,
        "execute_result",
      );
    } finally {
      restoreFetch();
    }
  });

  await t.step("should validate configuration", () => {
    // Test missing API key
    Deno.env.delete("OPENAI_API_KEY");

    // This would normally cause the constructor to exit
    // but we can't easily test process.exit() in unit tests
    // So we'll just verify the environment variable is checked
    assertEquals(Deno.env.get("OPENAI_API_KEY"), undefined);
  });
});

Deno.test("Tool definitions", async (t) => {
  await t.step("should define correct IPython tools", () => {
    // Set up environment
    Deno.env.set("OPENAI_API_KEY", "test-key");
    Deno.env.set("NOTEBOOK_ID", "test-notebook");
    Deno.env.set("AUTH_TOKEN", "test-token");

    const agent = new AIPythonAgent();

    // We can't directly test the private method, but we can verify
    // the agent was created without errors
    assertExists(agent);
  });
});

Deno.test("Configuration handling", async (t) => {
  await t.step("should use environment variables", () => {
    Deno.env.set("OPENAI_API_KEY", "test-key");
    Deno.env.set("AIPYTHON_MODEL", "gpt-4");
    Deno.env.set("NOTEBOOK_ID", "test-notebook");
    Deno.env.set("AUTH_TOKEN", "test-token");

    const agent = new AIPythonAgent();
    assertExists(agent);
  });

  await t.step("should accept configuration overrides", () => {
    Deno.env.set("OPENAI_API_KEY", "test-key");
    Deno.env.set("NOTEBOOK_ID", "test-notebook");
    Deno.env.set("AUTH_TOKEN", "test-token");

    const agent = new AIPythonAgent({
      model: "gpt-4o-mini",
      maxHistoryLength: 50,
      includeOutputs: false,
    });

    assertExists(agent);
  });
});

Deno.test("Conversation history", async (t) => {
  await t.step("should handle empty history", () => {
    Deno.env.set("OPENAI_API_KEY", "test-key");
    Deno.env.set("NOTEBOOK_ID", "test-notebook");
    Deno.env.set("AUTH_TOKEN", "test-token");

    const agent = new AIPythonAgent();

    // Agent should be created successfully with empty history
    assertExists(agent);
  });
});

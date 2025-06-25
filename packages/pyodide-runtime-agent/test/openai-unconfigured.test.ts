import { assert, assertExists } from "jsr:@std/assert@1.0.13";
import { RuntOpenAIClient } from "../src/openai-client.ts";

Deno.test("OpenAI Client - Unconfigured Message", async (t) => {
  // Store original API key to restore later
  const originalApiKey = Deno.env.get("OPENAI_API_KEY");

  await t.step("setup - remove API key", () => {
    // Force remove API key from environment
    Deno.env.delete("OPENAI_API_KEY");
  });

  await t.step(
    "shows helpful message when API key not configured",
    async () => {
      // Create client without API key
      const client = new RuntOpenAIClient();
      // Don't call configure() or pass empty config to ensure unconfigured state
      client.configure();

      // Test generateResponse method
      const response = await client.generateResponse(
        "What is machine learning?",
      );

      assert(response.length > 0, "Should return config help output");
      const helpOutput = response[0];
      assertExists(helpOutput);
      assert(helpOutput.type === "display_data", "Should be display_data type");

      const helpMessage = helpOutput.data["text/markdown"] as string;
      assert(
        helpMessage.includes(
          "AI has not been configured for this runtime yet",
        ),
        `Help message should include configuration text, got: ${helpMessage}`,
      );
      assert(
        helpMessage.includes("OPENAI_API_KEY"),
        `Help message should mention OPENAI_API_KEY, got: ${helpMessage}`,
      );
      assert(
        helpMessage.includes("deno run"),
        `Help message should include usage example, got: ${helpMessage}`,
      );

      console.log("✅ generateResponse unconfigured message verified");
    },
  );

  await t.step(
    "shows helpful message in generateResponseWithMessages",
    async () => {
      const client = new RuntOpenAIClient();
      client.configure(); // No API key

      const messages = [{ role: "user" as const, content: "Hello" }];
      const response = await client.generateResponseWithMessages(messages);

      assert(response.length > 0, "Should return config help output");
      const helpOutput = response[0];
      assertExists(helpOutput);
      assert(helpOutput.type === "display_data", "Should be display_data type");

      const helpMessage = helpOutput.data["text/markdown"] as string;
      assert(
        helpMessage.includes(
          "AI has not been configured for this runtime yet",
        ),
        `Help message should include configuration text, got: ${helpMessage}`,
      );

      console.log(
        "✅ generateResponseWithMessages unconfigured message verified",
      );
    },
  );

  await t.step(
    "shows helpful message in generateStreamingResponse",
    async () => {
      const client = new RuntOpenAIClient();
      client.configure(); // No API key

      const response = await client.generateStreamingResponse("Test prompt");

      assert(response.length > 0, "Should return config help output");
      const helpOutput = response[0];
      assertExists(helpOutput);
      assert(helpOutput.type === "display_data", "Should be display_data type");

      const helpMessage = helpOutput.data["text/markdown"] as string;
      assert(
        helpMessage.includes(
          "AI has not been configured for this runtime yet",
        ),
        `Help message should include configuration text, got: ${helpMessage}`,
      );

      console.log("✅ generateStreamingResponse unconfigured message verified");
    },
  );

  await t.step(
    "integration test - AI cell shows configuration message",
    async () => {
      // Import here to avoid module loading issues
      const { PyodideRuntimeAgent } = await import("../src/pyodide-agent.ts");
      const { events, tables } = await import("@runt/schema");

      // Create agent without API key
      const agentArgs = [
        "--kernel-id",
        "config-test-kernel",
        "--notebook",
        "config-test-notebook",
        "--auth-token",
        "config-test-token",
        "--sync-url",
        "ws://localhost:8787",
      ];

      const agent = new PyodideRuntimeAgent(agentArgs);
      await agent.start();

      try {
        const store = agent.store;

        // Create an AI cell
        const aiCellId = "config-test-cell";
        store.commit(
          events.cellCreated({
            id: aiCellId,
            cellType: "ai",
            position: 1,
            createdBy: "test",
          }),
        );

        // Set the AI cell source
        store.commit(
          events.cellSourceChanged({
            id: aiCellId,
            source: "What is machine learning?",
            modifiedBy: "test",
          }),
        );

        // Request execution
        const queueId = `exec-${Date.now()}-${
          Math.random().toString(36).slice(2)
        }`;
        store.commit(
          events.executionRequested({
            queueId: queueId,
            cellId: aiCellId,
            executionCount: 1,
            requestedBy: "test",
            priority: 1,
          }),
        );

        // Wait for execution to complete
        let attempts = 0;
        const maxAttempts = 10;
        while (attempts < maxAttempts) {
          const queueEntries = store.query(
            tables.executionQueue.select().where({ cellId: aiCellId }),
          );

          if (queueEntries.length > 0) {
            const entry = queueEntries[0];
            if (
              entry &&
              (entry.status === "completed" || entry.status === "failed")
            ) {
              break;
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 1000));
          attempts++;
        }

        // Check outputs for configuration message
        const outputs = store.query(
          tables.outputs.select().where({ cellId: aiCellId }),
        );

        assert(outputs.length > 0, "Should have output from AI cell execution");

        const helpOutput = outputs.find((output) =>
          output.outputType === "display_data"
        );
        assert(
          helpOutput,
          "Should have display output when AI is unconfigured",
        );

        const helpMessage = helpOutput.data["text/markdown"] as string;
        assert(
          helpMessage.includes("AI has not been configured"),
          `Should show configuration message, got: ${helpMessage}`,
        );

        console.log("✅ Integration test: AI cell shows configuration message");
      } finally {
        await agent.shutdown();
      }
    },
  );

  await t.step("cleanup - restore API key", () => {
    // Restore original API key if it existed
    if (originalApiKey) {
      Deno.env.set("OPENAI_API_KEY", originalApiKey);
    }
  });
});

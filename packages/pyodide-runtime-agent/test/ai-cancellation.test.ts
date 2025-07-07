import { assertEquals, assertExists } from "jsr:@std/assert@1.0.13";
import { PyodideRuntimeAgent } from "../src/pyodide-agent.ts";
import { events, tables } from "@runt/schema";
import { withQuietConsole } from "../../lib/test/test-config.ts";

// Configure test environment for quiet logging
Deno.env.set("RUNT_LOG_LEVEL", "ERROR");
Deno.env.set("RUNT_DISABLE_CONSOLE_LOGS", "true");

Deno.test("PyodideRuntimeAgent - AI Cell Cancellation", async (t) => {
  let agent: PyodideRuntimeAgent | undefined;

  await t.step("setup AI cancellation test environment", async () => {
    await withQuietConsole(async () => {
      const agentArgs = [
        "--kernel-id",
        "ai-cancel-test-kernel",
        "--notebook",
        "ai-cancel-test-notebook",
        "--auth-token",
        "ai-cancel-test-token",
        "--sync-url",
        "ws://localhost:8787",
      ];

      agent = new PyodideRuntimeAgent(agentArgs);
      assertExists(agent);
      assertEquals(agent.config.capabilities.canExecuteAi, true);

      await withQuietConsole(async () => {
        if (!agent) throw new Error("Agent not initialized");
        await agent.start();
      });
    });
  });

  await t.step("AI cell cancellation clears execution state", async () => {
    if (!agent) throw new Error("Agent not initialized");
    const store = agent.store;

    // Create an AI cell
    const aiCellId = "ai-cell-cancel-test";
    store.commit(
      events.cellCreated({
        id: aiCellId,
        cellType: "ai",
        position: 1,
        createdBy: "test",
      }),
    );

    // Set a long-running AI prompt
    const prompt = "Explain quantum computing in great detail with examples";
    store.commit(
      events.cellSourceChanged({
        id: aiCellId,
        source: prompt,
        modifiedBy: "test",
      }),
    );

    // Create a code cell that should NOT execute if cancellation works
    const codeCellId = "code-cell-after-ai";
    store.commit(
      events.cellCreated({
        id: codeCellId,
        cellType: "code",
        position: 2,
        createdBy: "test",
      }),
    );

    store.commit(
      events.cellSourceChanged({
        id: codeCellId,
        source: "print('This should not execute after AI cancellation')",
        modifiedBy: "test",
      }),
    );

    // Request AI execution
    const aiQueueId = `exec-ai-${Date.now()}-${
      Math.random().toString(36).slice(2)
    }`;
    store.commit(
      events.executionRequested({
        queueId: aiQueueId,
        cellId: aiCellId,
        executionCount: 1,
        requestedBy: "test",
        priority: 1,
      }),
    );

    // Wait a moment for AI execution to start
    const startDelay = setTimeout(() => {}, 500);
    await new Promise((resolve) => setTimeout(resolve, 500));
    clearTimeout(startDelay);

    // Cancel the AI execution
    store.commit(
      events.executionCancelled({
        queueId: aiQueueId,
        cellId: aiCellId,
        reason: "user_cancelled",
        cancelledBy: "test",
      }),
    );

    // Request code execution immediately after cancellation
    const codeQueueId = `exec-code-${Date.now()}-${
      Math.random().toString(36).slice(2)
    }`;
    store.commit(
      events.executionRequested({
        queueId: codeQueueId,
        cellId: codeCellId,
        executionCount: 1,
        requestedBy: "test",
        priority: 1,
      }),
    );

    // Wait for both executions to complete or fail
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const aiQueueEntry = store.query(
        tables.executionQueue.select().where({ id: aiQueueId }),
      )[0];
      const codeQueueEntry = store.query(
        tables.executionQueue.select().where({ id: codeQueueId }),
      )[0];

      if (
        aiQueueEntry?.status === "cancelled" &&
        (codeQueueEntry?.status === "completed" ||
          codeQueueEntry?.status === "failed")
      ) {
        break;
      }

      const waitTimeout = setTimeout(() => {}, 1000);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      clearTimeout(waitTimeout);
      attempts++;
    }

    // Verify AI execution was cancelled
    const aiQueueEntry = store.query(
      tables.executionQueue.select().where({ id: aiQueueId }),
    )[0];
    assertExists(aiQueueEntry);
    assertEquals(
      aiQueueEntry.status,
      "cancelled",
      "AI execution should be cancelled",
    );

    // Verify code execution completed successfully (no interrupt leak)
    const codeQueueEntry = store.query(
      tables.executionQueue.select().where({ id: codeQueueId }),
    )[0];
    assertExists(codeQueueEntry);
    assertEquals(
      codeQueueEntry.status,
      "completed",
      "Code execution should complete successfully without interrupt leak",
    );

    // Verify code cell outputs don't contain KeyboardInterrupt
    const codeOutputs = store.query(
      tables.outputs.select().where({ cellId: codeCellId }),
    );

    for (const output of codeOutputs) {
      const outputText = JSON.stringify(output.data);
      assertEquals(
        outputText.includes("KeyboardInterrupt"),
        false,
        "Code cell output should not contain KeyboardInterrupt from AI cancellation",
      );
    }

    // Only show success message in verbose mode
    if (Deno.env.get("RUNT_LOG_LEVEL") === "DEBUG") {
      console.log("✅ AI cell cancellation test successful");
    }
  });

  await t.step("cleanup", async () => {
    if (agent) {
      await agent.shutdown();
      agent = undefined;
    }
  });
});

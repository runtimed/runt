import { assertEquals, assertExists } from "jsr:@std/assert@1.0.13";
import { PyodideRuntimeAgent } from "../src/pyodide-agent.ts";
import { events, tables } from "@runt/schema";
import { withQuietConsole } from "../../lib/test/test-config.ts";

// Configure test environment for quiet logging
Deno.env.set("RUNT_LOG_LEVEL", "ERROR");
Deno.env.set("RUNT_DISABLE_CONSOLE_LOGS", "true");

Deno.test("PyodideRuntimeAgent - AI Cell Integration", async (t) => {
  let agent: PyodideRuntimeAgent | undefined;

  await t.step("setup AI cell test environment", async () => {
    await withQuietConsole(async () => {
      const agentArgs = [
        "--kernel-id",
        "ai-test-kernel",
        "--notebook",
        "ai-test-notebook",
        "--auth-token",
        "ai-test-token",
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

  await t.step("can execute AI cell with mock response", async () => {
    if (!agent) throw new Error("Agent not initialized");
    const store = agent.store;

    // Create an AI cell
    const aiCellId = "ai-cell-test-1";
    store.commit(
      events.cellCreated({
        id: aiCellId,
        cellType: "ai",
        position: 1,
        createdBy: "test",
      }),
    );

    // Set the AI cell source
    const prompt = "Explain what machine learning is in simple terms";
    store.commit(
      events.cellSourceChanged({
        id: aiCellId,
        source: prompt,
        modifiedBy: "test",
      }),
    );

    // Request execution
    const queueId1 = `exec-${Date.now()}-${
      Math.random().toString(36).slice(2)
    }`;
    store.commit(
      events.executionRequested({
        queueId: queueId1,
        cellId: aiCellId,
        executionCount: 1,
        requestedBy: "test",
        priority: 1,
      }),
    );

    // Wait for execution to complete with shorter timeout
    let attempts = 0;
    const maxAttempts = 20; // 20 seconds max wait
    while (attempts < maxAttempts) {
      const queueEntries = store.query(
        tables.executionQueue.select().where({ cellId: aiCellId }),
      );

      if (queueEntries.length > 0) {
        const entry = queueEntries[0];
        if (
          entry && (entry.status === "completed" || entry.status === "failed")
        ) {
          assertEquals(entry.status, "completed");
          break;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    // Check that we got outputs
    const outputs = store.query(
      tables.outputs.select().where({ cellId: aiCellId }),
    );

    assertExists(outputs);
    assertEquals(outputs.length > 0, true, "Should have at least one output");

    // Check that the output is AI-related
    const output = outputs[0];
    assertExists(output);
    assertExists(output.data);

    // For AI responses, we expect markdown output with content
    if (
      output.data && typeof output.data === "object" &&
      "text/markdown" in output.data
    ) {
      const content = String(output.data["text/markdown"]);
      assertExists(content);
      assertEquals(
        content.length > 10,
        true,
        "Should have substantial AI response content",
      );
      // Only show response in verbose mode
      if (Deno.env.get("RUNT_LOG_LEVEL") === "DEBUG") {
        console.log(`✅ AI response received: ${content.slice(0, 100)}...`);
      }
    }

    // Only show success message in verbose mode
    if (Deno.env.get("RUNT_LOG_LEVEL") === "DEBUG") {
      console.log("✅ AI cell executed successfully with mock response");
    }
  });

  await t.step("can handle AI cell tool calling (create_cell)", async () => {
    if (!agent) throw new Error("Agent not initialized");
    const store = agent.store;

    // Create an AI cell that should trigger tool calling
    const aiCellId = "ai-cell-tool-test";
    store.commit(
      events.cellCreated({
        id: aiCellId,
        cellType: "ai",
        position: 2,
        createdBy: "test",
      }),
    );

    // Set a prompt that should trigger cell creation in a real scenario
    const prompt = "Create a Python cell that prints 'Hello, AI!'";
    store.commit(
      events.cellSourceChanged({
        id: aiCellId,
        source: prompt,
        modifiedBy: "test",
      }),
    );

    // Request execution
    const queueId2 = `exec-${Date.now()}-${
      Math.random().toString(36).slice(2)
    }`;
    store.commit(
      events.executionRequested({
        queueId: queueId2,
        cellId: aiCellId,
        executionCount: 1,
        requestedBy: "test",
        priority: 1,
      }),
    );

    // Wait for execution to complete
    let attempts = 0;
    const maxAttempts = 20;
    while (attempts < maxAttempts) {
      const queueEntries = store.query(
        tables.executionQueue.select().where({ cellId: aiCellId }),
      );

      if (queueEntries.length > 0) {
        const entry = queueEntries[0];
        if (
          entry && (entry.status === "completed" || entry.status === "failed")
        ) {
          assertEquals(entry.status, "completed");
          break;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    // Only show success message in verbose mode
    if (Deno.env.get("RUNT_LOG_LEVEL") === "DEBUG") {
      console.log("✅ AI cell tool calling test completed (mock mode)");
    }
  });

  await t.step("can handle mixed AI and Python cells", async () => {
    if (!agent) throw new Error("Agent not initialized");
    const store = agent.store;

    // Create a Python cell first
    const pythonCellId = "python-cell-mixed";
    store.commit(
      events.cellCreated({
        id: pythonCellId,
        cellType: "code",
        position: 3,
        createdBy: "test",
      }),
    );

    store.commit(
      events.cellSourceChanged({
        id: pythonCellId,
        source: "x = 42\nprint(f'The answer is {x}')",
        modifiedBy: "test",
      }),
    );

    // Execute Python cell first
    const queueId3 = `exec-${Date.now()}-${
      Math.random().toString(36).slice(2)
    }`;
    store.commit(
      events.executionRequested({
        queueId: queueId3,
        cellId: pythonCellId,
        executionCount: 1,
        requestedBy: "test",
        priority: 1,
      }),
    );

    // Wait for Python execution
    let attempts = 0;
    while (attempts < 15) {
      const queueEntries = store.query(
        tables.executionQueue.select().where({ cellId: pythonCellId }),
      );

      if (
        queueEntries.length > 0 && queueEntries[0] &&
        queueEntries[0].status === "completed"
      ) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    // Now create an AI cell that can see the Python cell
    const aiCellId = "ai-cell-context";
    store.commit(
      events.cellCreated({
        id: aiCellId,
        cellType: "ai",
        position: 4,
        createdBy: "test",
      }),
    );

    store.commit(
      events.cellSourceChanged({
        id: aiCellId,
        source: "What did the previous Python cell do?",
        modifiedBy: "test",
      }),
    );

    // Execute AI cell
    const queueId4 = `exec-${Date.now()}-${
      Math.random().toString(36).slice(2)
    }`;
    store.commit(
      events.executionRequested({
        queueId: queueId4,
        cellId: aiCellId,
        executionCount: 1,
        requestedBy: "test",
        priority: 1,
      }),
    );

    // Wait for AI execution
    attempts = 0;
    while (attempts < 15) {
      const queueEntries = store.query(
        tables.executionQueue.select().where({ cellId: aiCellId }),
      );

      if (
        queueEntries.length > 0 && queueEntries[0] &&
        queueEntries[0].status === "completed"
      ) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    // Check that AI cell completed
    const aiOutputs = store.query(
      tables.outputs.select().where({ cellId: aiCellId }),
    );

    assertExists(aiOutputs);
    assertEquals(aiOutputs.length > 0, true, "AI cell should have outputs");

    // Only show success message in verbose mode
    if (Deno.env.get("RUNT_LOG_LEVEL") === "DEBUG") {
      console.log("✅ Mixed AI and Python cell execution successful");
    }
  });

  await t.step("cleanup", async () => {
    if (agent) {
      try {
        await withQuietConsole(async () => {
          if (!agent) throw new Error("Agent not initialized");
          await agent.shutdown();
        });
        agent = undefined;
        // Only show cleanup message in verbose mode
        if (Deno.env.get("RUNT_LOG_LEVEL") === "DEBUG") {
          console.log("✅ AI cell integration test cleanup complete");
        }
      } catch (error) {
        console.error("Error during test cleanup:", error);
      }
    }
  });
});

Deno.test("PyodideRuntimeAgent - AI Cell Error Handling", async (t) => {
  let agent: PyodideRuntimeAgent | undefined;

  await t.step("setup", async () => {
    await withQuietConsole(async () => {
      const agentArgs = [
        "--kernel-id",
        "ai-error-test-kernel",
        "--notebook",
        "ai-error-test-notebook",
        "--auth-token",
        "ai-error-test-token",
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

  await t.step("handles empty AI cell gracefully", async () => {
    if (!agent) throw new Error("Agent not initialized");
    const store = agent.store;

    // Create an AI cell with empty content
    const aiCellId = "ai-cell-empty";
    store.commit(
      events.cellCreated({
        id: aiCellId,
        cellType: "ai",
        position: 1,
        createdBy: "test",
      }),
    );

    // Don't set any source (empty cell)

    // Request execution
    const queueId5 = `exec-${Date.now()}-${
      Math.random().toString(36).slice(2)
    }`;
    store.commit(
      events.executionRequested({
        queueId: queueId5,
        cellId: aiCellId,
        executionCount: 1,
        requestedBy: "test",
        priority: 1,
      }),
    );

    // Wait for execution to complete
    let attempts = 0;
    while (attempts < 10) {
      const queueEntries = store.query(
        tables.executionQueue.select().where({ cellId: aiCellId }),
      );

      if (queueEntries.length > 0) {
        const entry = queueEntries[0];
        if (
          entry && (entry.status === "completed" || entry.status === "failed")
        ) {
          // Empty AI cells should complete successfully (no-op)
          assertEquals(entry.status, "completed");
          break;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
      attempts++;
    }

    // Only show success message in verbose mode
    if (Deno.env.get("RUNT_LOG_LEVEL") === "DEBUG") {
      console.log("✅ Empty AI cell handled gracefully");
    }
  });

  await t.step("cleanup", async () => {
    if (agent) {
      try {
        await withQuietConsole(async () => {
          if (!agent) throw new Error("Agent not initialized");
          await agent.shutdown();
        });
        agent = undefined;
      } catch (error) {
        console.error("Error during test cleanup:", error);
      }
    }
  });
});

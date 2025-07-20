// PyodideRuntimeAgent Integration Test
//
// This is the primary integration test that verifies the complete
// execution pipeline works. Uses in-memory LiveStore for simplicity -
// no external infrastructure required!

import { assertEquals, assertExists } from "jsr:@std/assert";
import { delay } from "jsr:@std/async/delay";
import { crypto } from "jsr:@std/crypto";
import { PyodideRuntimeAgent } from "../src/pyodide-agent.ts";
import { events, tables } from "@runt/schema";
import { queryDb } from "npm:@livestore/livestore";
import { withQuietConsole } from "../../lib/test/test-config.ts";

// Configure test environment for quiet logging
Deno.env.set("RUNT_LOG_LEVEL", "ERROR");
Deno.env.set("RUNT_DISABLE_CONSOLE_LOGS", "true");

Deno.test({
  name: "PyodideRuntimeAgent - Complete Integration",
  sanitizeOps: false, // Agent uses signal handlers for shutdown
  sanitizeResources: false, // Agent creates background processes
  ignore: true, // Skip temporarily due to execution timing issues
}, async (t) => {
  let agent: PyodideRuntimeAgent | undefined;

  try {
    await t.step("can create agent with test config", async () => {
      await withQuietConsole(() => {
        const notebookId = `test-${crypto.randomUUID()}`;
        const runtimeId = `runtime-${crypto.randomUUID()}`;

        // Use a local-only sync URL - LiveStore works purely in-memory
        const agentArgs = [
          "--runtime-id",
          runtimeId,
          "--notebook",
          notebookId,
          "--auth-token",
          "test-token",
          "--sync-url",
          "ws://localhost:9999", // Won't connect, but that's fine
        ];

        agent = new PyodideRuntimeAgent(agentArgs);

        assertExists(agent);
        assertEquals(agent.config.notebookId, notebookId);
        assertEquals(agent.config.runtimeId, runtimeId);
        assertEquals(agent.config.authToken, "test-token");
      });
    });

    await t.step("can start agent", async () => {
      if (!agent) throw new Error("Agent not created");

      // LiveStore works in-memory without external sync
      await agent.start();

      // Give it a moment to fully initialize
      await delay(1000);

      assertExists(agent);
    });

    await t.step("can execute Python code and get results", async () => {
      if (!agent) throw new Error("Agent not started");

      // Testing complete execution pipeline

      // Create notebook
      const notebookId = agent.config.notebookId;
      agent.store.commit(events.notebookInitialized({
        id: notebookId,
        title: "Integration Test Notebook",
        ownerId: "test-user",
      }));

      // Create a cell with Python arithmetic
      const cellId = `cell-${crypto.randomUUID()}`;
      agent.store.commit(events.cellCreated({
        id: cellId,
        position: 0,
        cellType: "code",
        createdBy: "test-user",
      }));

      // Test basic arithmetic
      const pythonCode = "3 * 7";
      agent.store.commit(events.cellSourceChanged({
        id: cellId,
        source: pythonCode,
        modifiedBy: "test-user",
      }));

      // Request execution
      const queueId = `exec-${Date.now()}-${
        Math.random().toString(36).slice(2)
      }`;
      agent.store.commit(events.executionRequested({
        queueId,
        cellId,
        executionCount: 1,
        requestedBy: "test-user",
      }));

      // Waiting for agent to process execution

      // Wait for execution to complete
      await delay(3000);

      // Check results
      const queueEntries = agent.store.query(queryDb(
        tables.executionQueue.select().where({ cellId }),
      ));

      const outputs = agent.store.query(queryDb(
        tables.outputs.select().where({ cellId }),
      ));

      // Queue status: ${queueEntries[0]?.status}
      // Outputs found: ${outputs.length}

      if (outputs.length > 0) {
        // Output type: ${outputs[0]?.outputType}
        // Output data: ${JSON.stringify(outputs[0]?.data)}
      }

      // Verify execution worked in pure in-memory mode
      assertEquals(queueEntries.length, 1, "Should have queue entry");
      assertEquals(
        queueEntries[0]?.status,
        "completed",
        "Should be completed",
      );
      assertEquals(outputs.length, 1, "Should have one output");
      assertEquals(
        outputs[0]?.outputType,
        "multimedia_result",
        "Should be multimedia_result",
      );

      // Verify the arithmetic result - check representations for multimedia output
      const outputData = outputs[0]?.representations as {
        "text/plain": { type: "inline"; data: string };
      };
      assertEquals(
        outputData?.["text/plain"]?.data,
        "21",
        "3 * 7 should equal 21",
      );

      // Complete integration test successful
    });
  } finally {
    // Always cleanup
    if (agent) {
      await agent.shutdown();
    }
  }
});

// PyodideRuntimeAgent Integration Test
//
// This is the primary integration test that verifies the complete
// execution pipeline works. Uses in-memory LiveStore for simplicity -
// no external infrastructure required!

import { assertEquals, assertExists } from "jsr:@std/assert";
import { delay } from "jsr:@std/async/delay";
import { crypto } from "jsr:@std/crypto";
import { makeAdapter } from "npm:@livestore/adapter-node";
import { PyodideRuntimeAgent } from "../src/pyodide-agent.ts";
import {
  cellReferences$,
  createCellBetween,
  events,
  tables,
} from "@runt/schema";

import { withQuietConsole } from "../../lib/test/test-config.ts";

// Configure test environment for quiet logging
Deno.env.set("RUNT_LOG_LEVEL", "ERROR");
Deno.env.set("RUNT_DISABLE_CONSOLE_LOGS", "true");

Deno.test({
  name: "PyodideRuntimeAgent - Complete Integration",
  sanitizeOps: false, // Agent uses signal handlers for shutdown
  sanitizeResources: false, // Agent creates background processes
  ignore: Deno.env.get("CI") === "true", // Skip in CI due to Pyodide WASM compatibility issues
}, async (t) => {
  let agent: PyodideRuntimeAgent | undefined;

  try {
    await t.step("can create agent with test config", async () => {
      await withQuietConsole(() => {
        const notebookId = `test-${crypto.randomUUID()}`;
        const runtimeId = `runtime-${crypto.randomUUID()}`;

        // Create explicit in-memory adapter for true isolation
        const adapter = makeAdapter({
          storage: { type: "in-memory" },
        });

        const agentArgs = [
          "--runtime-id",
          runtimeId,
          "--notebook",
          notebookId,
          "--auth-token",
          "test-token",
          "--sync-url",
          "ws://localhost:9999", // Not used with explicit adapter
        ];

        agent = new PyodideRuntimeAgent(agentArgs, {}, {
          adapter,
        });

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
      const cellList = agent.store.query(cellReferences$);
      const createResult = createCellBetween(
        {
          id: cellId,
          cellType: "code",
          createdBy: "test-user",
        },
        null,
        null,
        cellList,
      );
      createResult.events.forEach((event) => agent!.store.commit(event));

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

      // Wait for execution to complete with polling
      let queueEntries = agent.store.query(
        tables.executionQueue.select().where({ cellId }),
      );

      // Wait up to 10 seconds for execution to complete
      const maxWaitTime = 10000; // 10 seconds
      const startTime = Date.now();

      while (
        queueEntries.length === 0 || queueEntries[0]?.status !== "completed"
      ) {
        if (Date.now() - startTime > maxWaitTime) {
          break;
        }
        await delay(500); // Check every 500ms
        queueEntries = agent.store.query(
          tables.executionQueue.select().where({ cellId }),
        );
      }

      const outputs = agent.store.query(
        tables.outputs.select().where({ cellId }),
      );

      // Verify execution worked in pure in-memory mode
      assertEquals(queueEntries.length, 1, "Should have queue entry");
      assertEquals(
        queueEntries[0]?.status,
        "completed",
        "Should be completed",
      );
      assertEquals(
        outputs.length >= 1,
        true,
        "Should have at least one output",
      );
      // Find the result output (there may be multiple outputs including terminal/status)
      const resultOutput = outputs.find((o) =>
        o.outputType === "multimedia_result"
      );
      assertExists(resultOutput, "Should have multimedia_result output");
      assertEquals(
        resultOutput.outputType,
        "multimedia_result",
        "Should be multimedia_result",
      );

      // Verify the arithmetic result - check representations for multimedia output
      const outputData = resultOutput.representations as {
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

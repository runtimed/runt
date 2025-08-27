import { assertEquals, assertExists } from "jsr:@std/assert@1.0.13";
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
  name: "PyodideRuntimeAgent - AI Cell Error Handling",
  ignore: Deno.env.get("CI") === "true", // Skip in CI due to Pyodide WASM compatibility issues
}, async (t) => {
  let agent: PyodideRuntimeAgent | undefined;

  try {
    await t.step("setup", async () => {
      await withQuietConsole(async () => {
        const agentArgs = [
          "--runtime-id",
          "ai-error-test-runtime",
          "--notebook",
          "ai-error-test-notebook",
          "--auth-token",
          "ai-error-test-token",
          "--sync-url",
          "ws://localhost:8787",
        ];

        agent = new PyodideRuntimeAgent(agentArgs, {}, {
          clientId: "ai-error-test-client",
        });
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

      // Create an AI cell with empty content
      const aiCellId = "ai-cell-empty";
      const cellList = agent.store.query(cellReferences$);
      const createResult = createCellBetween(
        {
          id: aiCellId,
          cellType: "ai",
          createdBy: "test",
        },
        null,
        null,
        cellList,
      );
      createResult.events.forEach((event) => agent!.store.commit(event));

      // Don't set any source (empty cell)

      // Request execution
      const queueId5 = `exec-${Date.now()}-${
        Math.random().toString(36).slice(2)
      }`;
      agent.store.commit(
        events.executionRequested({
          queueId: queueId5,
          cellId: aiCellId,
          executionCount: 1,
          requestedBy: "test",
        }),
      );

      // Wait for execution to complete
      let attempts = 0;
      while (attempts < 10) {
        const queueEntries = agent.store.query(
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
  } finally {
    if (agent) {
      await agent.shutdown();
    }
  }
});

/// <reference lib="deno.ns" />

import {
  createStorePromise,
  makeSchema,
  State,
  type Store as LiveStore,
} from "@livestore/livestore";

import { makeAdapter } from "npm:@livestore/adapter-node";

import { assertEquals } from "jsr:@std/assert";
import { assert } from "jsr:@std/assert";

import { events, materializers, tables } from "@runt/schema";

// Create the schema for testing
const state = State.SQLite.makeState({ tables, materializers });
const schema = makeSchema({ events, state });

// Type for the store created by setupStore
type TestStore = LiveStore<typeof schema>;

// Simple mapping of events to their date fields
const EVENT_DATE_FIELDS: Record<string, string[]> = {
  executionStarted: ["startedAt"],
  executionCompleted: ["completedAt"],
  toolApprovalRequested: ["requestedAt"],
  toolApprovalResponded: ["respondedAt"],
};

// Helper function to convert date strings to Date objects
function convertDatesForEvent(
  eventName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const dateFields = EVENT_DATE_FIELDS[eventName] || [];
  if (dateFields.length === 0) {
    return args;
  }

  const result = { ...args };

  for (const fieldName of dateFields) {
    if (
      result[fieldName] && typeof result[fieldName] === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(
        result[fieldName] as string,
      )
    ) {
      result[fieldName] = new Date(result[fieldName] as string);
    }
  }

  return result;
}

async function setupStore() {
  const adapter = makeAdapter({
    storage: { type: "in-memory" },
    // sync: { backend: makeCfSync({ url: '...' }) },
  });

  const store: LiveStore<typeof schema> = await createStorePromise({
    adapter,
    schema,
    storeId: "test",
    onBootStatus: (status) => {
      console.table({
        status,
      });
    },
    otelOptions: {
      //   serviceName: "test",
      //   serviceVersion: "0.0.1",
    },
    disableDevtools: true,
  });

  return store;
}

Deno.test("simple schema test", async () => {
  const store = await setupStore();
  const cells = store.query(tables.cells);

  assertEquals(cells.length, 0);

  store.commit(events.cellCreated({
    id: "1",
    createdBy: "deno",
    cellType: "code",
    position: 0,
  }));

  assertEquals(store.query(tables.cells).length, 1);

  store.commit(events.cellSourceChanged({
    id: "1",
    source: "print('Hello, world!')",
    modifiedBy: "deno",
  }));

  assertEquals(store.query(tables.cells).length, 1);
  assertEquals(
    store.query(tables.cells.select().where({ id: "1" }))[0].source,
    "print('Hello, world!')",
  );

  store.shutdown();
});

Deno.test("simple ai test", async () => {
  const store = await setupStore();
  const cells = store.query(tables.cells);

  assertEquals(cells.length, 0);

  store.commit(events.cellCreated({
    id: "1",
    createdBy: "deno",
    cellType: "ai",
    position: 0,
  }));

  assertEquals(store.query(tables.cells).length, 1);

  store.commit(events.cellSourceChanged({
    id: "1",
    source: "Create some cells",
    modifiedBy: "deno",
  }));

  store.shutdown();
});

Deno.test("replay exported event log", async () => {
  const store = await setupStore();
  const jsonPath =
    new URL("./fixtures/exported-event-log.json", import.meta.url).pathname;
  const eventsJson = JSON.parse(await Deno.readTextFile(jsonPath));

  // Build a mapping from event .name to key in events object (robust)
  const eventNameToKey: Record<string, keyof typeof events> = {};
  for (const key of Object.keys(events) as Array<keyof typeof events>) {
    const eventDef = events[key];
    if (eventDef && typeof (eventDef as { name: string }).name === "string") {
      eventNameToKey[(eventDef as { name: string }).name] = key;
    }
  }

  // Clean event replay function
  function replayEvent(
    store: TestStore,
    eventName: string,
    args: Record<string, unknown>,
  ): boolean {
    const key = eventNameToKey[eventName];
    if (!key || !(key in events)) {
      console.warn(`Event not found in mapping: ${eventName}`);
      return false;
    }

    try {
      // Convert date strings to Date objects before calling event creator
      const convertedArgs = convertDatesForEvent(key, args);

      // Use the event creator function - it handles validation but needs proper Date objects
      const eventCreator = events[key as keyof typeof events];
      // deno-lint-ignore no-explicit-any
      const event = eventCreator(convertedArgs as any);

      // Commit the event to the store
      store.commit(event);
      return true;
    } catch (error) {
      console.error(`✗ Failed to replay event ${eventName}:`, error);
      return false;
    }
  }

  for (const entry of eventsJson) {
    const { name: eventName, argsJson } = entry;
    const args = typeof argsJson === "string" ? JSON.parse(argsJson) : argsJson;

    replayEvent(store, eventName, args);
  }

  // Verify the final state matches what we expect from the event log
  console.log("\n=== Final Store State Verification ===");

  // Check cells
  const cells = store.query(tables.cells);
  console.log(`Total cells: ${cells.length}`);

  // Debug: show all cell IDs
  const actualCellIds = cells.map((c) => ({
    id: c.id,
    type: c.cellType,
    position: c.position,
  }));
  console.log("Actual cells:", actualCellIds);

  assertEquals(cells.length, 5, "Should have 5 cells total"); // Updated expectation

  // Verify specific cells exist
  const cellIds = cells.map((c) => c.id).sort();
  const expectedCellIds = [
    "cell-1753241474553-dotqr594gcc", // Original AI cell
    "cell-1753241521907-hhl09jm9kfe", // Second AI cell
    "cell-1753241523364-daf3a5k3q8", // Code cell
    "cell-1753241523964-aqi5d3bbtij", // Markdown cell
    "cell-1753241524411-n9yq7x5388", // Third AI cell (from the end of the log)
  ].sort();
  assertEquals(cellIds, expectedCellIds, "Should have the expected cell IDs");

  // Check cell types
  const aiCells = cells.filter((c) => c.cellType === "ai");
  const codeCells = cells.filter((c) => c.cellType === "code");
  const markdownCells = cells.filter((c) => c.cellType === "markdown");
  assertEquals(aiCells.length, 3, "Should have 3 AI cells"); // Updated from 2 to 3
  assertEquals(codeCells.length, 1, "Should have 1 code cell");
  assertEquals(markdownCells.length, 1, "Should have 1 markdown cell");

  // Check runtime sessions
  const runtimeSessions = store.query(tables.runtimeSessions);
  console.log(`Total runtime sessions: ${runtimeSessions.length}`);
  assertEquals(runtimeSessions.length, 2, "Should have 2 runtime sessions");

  // Check that we have active runtime sessions
  const activeSessions = runtimeSessions.filter((s) => s.isActive);
  assertEquals(
    activeSessions.length,
    2,
    "Should have 2 active runtime sessions",
  );

  // Check execution queue
  const executionQueue = store.query(tables.executionQueue);
  console.log(`Total execution queue entries: ${executionQueue.length}`);
  assertEquals(executionQueue.length, 1, "Should have 1 execution queue entry");

  // Check that execution was completed
  const completedExecutions = executionQueue.filter((e) =>
    e.status === "completed"
  );
  assertEquals(
    completedExecutions.length,
    1,
    "Should have 1 completed execution",
  );

  // Check outputs
  const outputs = store.query(tables.outputs);
  console.log(`Total outputs: ${outputs.length}`);
  assert(outputs.length > 0, "Should have some outputs");

  // Check markdown outputs specifically
  const markdownOutputs = outputs.filter((o) => o.outputType === "markdown");
  console.log(`Markdown outputs: ${markdownOutputs.length}`);
  assert(markdownOutputs.length > 0, "Should have markdown outputs");

  // Check multimedia outputs
  const multimediaOutputs = outputs.filter((o) =>
    o.outputType === "multimedia_display"
  );
  console.log(`Multimedia outputs: ${multimediaOutputs.length}`);
  assert(multimediaOutputs.length > 0, "Should have multimedia outputs");

  // Check presence
  const presence = store.query(tables.presence);
  console.log(`Total presence entries: ${presence.length}`);
  assert(presence.length > 0, "Should have presence entries");

  // Check actors
  const actors = store.query(tables.actors);
  console.log(`Total actors: ${actors.length}`);
  assertEquals(
    actors.length,
    0,
    "Should have 0 actors (no ActorProfileSet events in log)",
  );

  console.log("✅ All state verifications passed!");

  store.shutdown();
});

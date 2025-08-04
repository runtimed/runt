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

Deno.test("fractional indexing - basic operations", async () => {
  const { fractionalIndexBetween, initialFractionalIndex } = await import(
    "@runt/schema"
  );

  // Initial index
  const first = initialFractionalIndex();
  assertEquals(first, "a0");

  // Insert after first
  const second = fractionalIndexBetween(first, null);
  assertEquals(second, "a1");
  assert(second > first);

  // Insert between first and second
  const middle = fractionalIndexBetween(first, second);
  assert(middle > first);
  assert(middle < second);

  // Insert before first
  const beforeFirst = fractionalIndexBetween(null, first);
  assert(beforeFirst < first);

  // Insert at very end
  const third = fractionalIndexBetween(second, null);
  assert(third > second);
});

Deno.test("v2.CellCreated with fractional indexing - comprehensive", async () => {
  const store = await setupStore();
  const { fractionalIndexBetween, initialFractionalIndex } = await import(
    "@runt/schema"
  );

  // Create first cell
  const firstOrder = initialFractionalIndex();
  store.commit(events.cellCreated2({
    id: "cell-1",
    fractionalIndex: firstOrder,
    cellType: "code",
    createdBy: "user1",
  }));

  // Create second cell after first
  const secondOrder = fractionalIndexBetween(firstOrder, null);
  store.commit(events.cellCreated2({
    id: "cell-2",
    fractionalIndex: secondOrder,
    cellType: "markdown",
    createdBy: "user1",
  }));

  // Create third cell between first and second
  const thirdOrder = fractionalIndexBetween(firstOrder, secondOrder);
  store.commit(events.cellCreated2({
    id: "cell-3",
    fractionalIndex: thirdOrder,
    cellType: "ai",
    createdBy: "user2",
  }));

  // Create fourth cell at the beginning
  const fourthOrder = fractionalIndexBetween(null, firstOrder);
  store.commit(events.cellCreated2({
    id: "cell-4",
    fractionalIndex: fourthOrder,
    cellType: "sql",
    createdBy: "user1",
  }));

  // Create fifth cell at the end
  const fifthOrder = fractionalIndexBetween(secondOrder, null);
  store.commit(events.cellCreated2({
    id: "cell-5",
    fractionalIndex: fifthOrder,
    cellType: "code",
    createdBy: "user2",
  }));

  // Verify cells exist
  const cells = store.query(tables.cells);
  assertEquals(cells.length, 5);

  // Verify cells have fractionalIndex column set
  const cellsWithOrder = cells.filter((c) => c.fractionalIndex !== null);
  assertEquals(
    cellsWithOrder.length,
    5,
    "All v2-created cells should have fractionalIndex",
  );

  // Query cells ordered by fractional index
  const orderedCells = store.query(
    tables.cells.select().orderBy(
      "fractionalIndex",
      "asc",
    ),
  ).filter((c) => c.fractionalIndex !== null);

  // Verify ordering
  const orderedIds = orderedCells.map((c) => c.id);
  assertEquals(orderedIds, ["cell-4", "cell-1", "cell-3", "cell-2", "cell-5"]);

  // Verify the fractional indices are properly ordered
  const orders = orderedCells.map((c) => c.fractionalIndex);
  for (let i = 1; i < orders.length; i++) {
    assert(
      orders[i]! > orders[i - 1]!,
      `Order ${orders[i]} should be > ${orders[i - 1]}`,
    );
  }

  // Test complex insertion scenario
  // Insert between cell-4 and cell-1
  const sixthOrder = fractionalIndexBetween(fourthOrder, firstOrder);
  store.commit(events.cellCreated2({
    id: "cell-6",
    fractionalIndex: sixthOrder,
    cellType: "markdown",
    createdBy: "user3",
  }));

  // Insert between cell-3 and cell-2
  const seventhOrder = fractionalIndexBetween(thirdOrder, secondOrder);
  store.commit(events.cellCreated2({
    id: "cell-7",
    fractionalIndex: seventhOrder,
    cellType: "ai",
    createdBy: "user3",
  }));

  // Final verification
  const finalOrderedCells = store.query(
    tables.cells.select().orderBy(
      "fractionalIndex",
      "asc",
    ),
  ).filter((c) => c.fractionalIndex !== null);

  const finalOrderedIds = finalOrderedCells.map((c) => c.id);
  assertEquals(
    finalOrderedIds,
    ["cell-4", "cell-6", "cell-1", "cell-3", "cell-7", "cell-2", "cell-5"],
    "Final ordering should reflect all insertions",
  );

  // Verify no position conflicts (all fractionalIndices are unique)
  const orderSet = new Set(finalOrderedCells.map((c) => c.fractionalIndex));
  assertEquals(
    orderSet.size,
    finalOrderedCells.length,
    "All fractionalIndices should be unique",
  );

  store.shutdown();
});

Deno.test("v2.CellCreated - simulating concurrent notebook editing", async () => {
  const store = await setupStore();
  const { fractionalIndexBetween, initialFractionalIndex } = await import(
    "@runt/schema"
  );

  // Initial notebook state: 3 cells
  const cell1Order = initialFractionalIndex();
  store.commit(events.cellCreated2({
    id: "initial-1",
    fractionalIndex: cell1Order,
    cellType: "markdown",
    createdBy: "author",
  }));

  const cell2Order = fractionalIndexBetween(cell1Order, null);
  store.commit(events.cellCreated2({
    id: "initial-2",
    fractionalIndex: cell2Order,
    cellType: "code",
    createdBy: "author",
  }));

  const cell3Order = fractionalIndexBetween(cell2Order, null);
  store.commit(events.cellCreated2({
    id: "initial-3",
    fractionalIndex: cell3Order,
    cellType: "ai",
    createdBy: "author",
  }));

  // Simulate User A and User B both inserting after initial-2
  // They both calculate the same position (between initial-2 and initial-3)
  const userAOrder = fractionalIndexBetween(cell2Order, cell3Order);
  const userBOrder = fractionalIndexBetween(cell2Order, cell3Order);

  // Both orders should be identical (deterministic)
  assertEquals(userAOrder, userBOrder);

  // User A commits first
  store.commit(events.cellCreated2({
    id: "user-a-cell",
    fractionalIndex: userAOrder,
    cellType: "code",
    createdBy: "userA",
  }));

  // User B commits second (with same order - this is a conflict scenario)
  store.commit(events.cellCreated2({
    id: "user-b-cell",
    fractionalIndex: userBOrder,
    cellType: "markdown",
    createdBy: "userB",
  }));

  // Both cells should exist
  const allCells = store.query(tables.cells);
  assertEquals(allCells.length, 5);

  // Query ordered cells
  const orderedCells = store.query(
    tables.cells.select().orderBy(
      "fractionalIndex",
      "asc",
    ),
  ).filter((c) => c.fractionalIndex !== null);

  // Even with same order, both cells should be present
  const cellIds = orderedCells.map((c) => c.id);
  assert(cellIds.includes("user-a-cell"));
  assert(cellIds.includes("user-b-cell"));

  // In practice, the frontend would need to handle this by:
  // 1. Detecting the conflict (two cells with same fractionalIndex)
  // 2. Reassigning one of them a new fractionalIndex
  // This is left as an exercise for the frontend implementation

  store.shutdown();
});

Deno.test("fractional indexing - concurrent inserts", async () => {
  const { fractionalIndexBetween } = await import("@runt/schema");

  // Simulate two users inserting after the same cell
  const cellA = "a0";
  const cellB = "b0";

  // User 1 inserts between A and B
  const user1Insert = fractionalIndexBetween(cellA, cellB);

  // User 2 also inserts between A and B (at the same time)
  const user2Insert = fractionalIndexBetween(cellA, cellB);

  // Both should get the same position (deterministic)
  assertEquals(user1Insert, user2Insert);

  // But if user 2 sees user 1's insert, they can insert after it
  const user2SecondInsert = fractionalIndexBetween(user1Insert, cellB);
  assert(user2SecondInsert > user1Insert);
  assert(user2SecondInsert < cellB);
});

Deno.test("fractional indexing - edge cases", async () => {
  const { fractionalIndexBetween, isValidFractionalIndex } = await import(
    "@runt/schema"
  );

  // Validate indices
  assert(isValidFractionalIndex("a0"));
  assert(isValidFractionalIndex("zzz999"));
  assert(!isValidFractionalIndex(""));
  assert(!isValidFractionalIndex("!@#"));

  // Many inserts in sequence
  let prev = "a0";
  const indices: string[] = [prev];

  for (let i = 0; i < 10; i++) {
    const next = fractionalIndexBetween(prev, null);
    assert(next > prev);
    indices.push(next);
    prev = next;
  }

  // All indices should be in order
  for (let i = 1; i < indices.length; i++) {
    assert(indices[i] > indices[i - 1]);
  }
});

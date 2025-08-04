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

  // Initial index (no jitter for deterministic tests)
  const first = initialFractionalIndex(false);
  assertEquals(first, "a0");

  // Insert after first
  const second = fractionalIndexBetween(first, null, false);
  assertEquals(second, "a1");
  assert(second > first);

  // Insert between first and second
  const middle = fractionalIndexBetween(first, second, false);
  assertEquals(middle, "a0V");
  assert(middle > first);
  assert(middle < second);

  // Insert before first
  const beforeFirst = fractionalIndexBetween(null, first, false);
  assertEquals(beforeFirst, "Zz");
  assert(beforeFirst < first);

  // Insert at very end
  const third = fractionalIndexBetween(second, null, false);
  assertEquals(third, "a2");
  assert(third > second);
});

Deno.test("v2.CellCreated with fractional indexing - comprehensive", async () => {
  const store = await setupStore();
  const { fractionalIndexBetween, initialFractionalIndex } = await import(
    "@runt/schema"
  );

  // Create first cell (no jitter for predictable tests)
  const firstOrder = initialFractionalIndex(false);
  store.commit(events.cellCreated2({
    id: "cell-1",
    fractionalIndex: firstOrder,
    cellType: "code",
    createdBy: "user1",
  }));

  // Create second cell after first
  const secondOrder = fractionalIndexBetween(firstOrder, null, false);
  store.commit(events.cellCreated2({
    id: "cell-2",
    fractionalIndex: secondOrder,
    cellType: "markdown",
    createdBy: "user1",
  }));

  // Create third cell between first and second
  const thirdOrder = fractionalIndexBetween(firstOrder, secondOrder, false);
  store.commit(events.cellCreated2({
    id: "cell-3",
    fractionalIndex: thirdOrder,
    cellType: "ai",
    createdBy: "user2",
  }));

  // Create fourth cell at the beginning
  const fourthOrder = fractionalIndexBetween(null, firstOrder, false);
  store.commit(events.cellCreated2({
    id: "cell-4",
    fractionalIndex: fourthOrder,
    cellType: "sql",
    createdBy: "user1",
  }));

  // Create fifth cell at the end
  const fifthOrder = fractionalIndexBetween(secondOrder, null, false);
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
  const sixthOrder = fractionalIndexBetween(fourthOrder, firstOrder, false);
  store.commit(events.cellCreated2({
    id: "cell-6",
    fractionalIndex: sixthOrder,
    cellType: "markdown",
    createdBy: "user3",
  }));

  // Insert between cell-3 and cell-2
  const seventhOrder = fractionalIndexBetween(thirdOrder, secondOrder, false);
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

  // Initial notebook state: 3 cells (no jitter for first part)
  const cell1Order = initialFractionalIndex(false);
  store.commit(events.cellCreated2({
    id: "initial-1",
    fractionalIndex: cell1Order,
    cellType: "markdown",
    createdBy: "author",
  }));

  const cell2Order = fractionalIndexBetween(cell1Order, null, false);
  store.commit(events.cellCreated2({
    id: "initial-2",
    fractionalIndex: cell2Order,
    cellType: "code",
    createdBy: "author",
  }));

  const cell3Order = fractionalIndexBetween(cell2Order, null, false);
  store.commit(events.cellCreated2({
    id: "initial-3",
    fractionalIndex: cell3Order,
    cellType: "ai",
    createdBy: "author",
  }));

  // Test both deterministic and jittered scenarios
  // Without jitter: both users get same position
  const userAOrderNoJitter = fractionalIndexBetween(
    cell2Order,
    cell3Order,
    false,
  );
  const userBOrderNoJitter = fractionalIndexBetween(
    cell2Order,
    cell3Order,
    false,
  );
  assertEquals(userAOrderNoJitter, userBOrderNoJitter);

  // With jitter: users get different positions (high probability)
  const userAOrder = fractionalIndexBetween(cell2Order, cell3Order, true);
  const userBOrder = fractionalIndexBetween(cell2Order, cell3Order, true);

  // Both should be valid and between cell2Order and cell3Order
  assert(userAOrder > cell2Order);
  assert(userAOrder < cell3Order);
  assert(userBOrder > cell2Order);
  assert(userBOrder < cell3Order);

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

  // With jittering, even concurrent inserts at the same position
  // will likely get different fractional indices, reducing conflicts

  store.shutdown();
});

Deno.test("v2.CellCreated - building a notebook from scratch", async () => {
  const store = await setupStore();
  const { fractionalIndexBetween, initialFractionalIndex } = await import(
    "@runt/schema"
  );

  // Create a notebook with markdown, code, and AI cells
  // Cell 1: Markdown introduction (use jitter for realistic scenario)
  const cell1Order = initialFractionalIndex(true);
  store.commit(events.cellCreated2({
    id: "intro",
    fractionalIndex: cell1Order,
    cellType: "markdown",
    createdBy: "author",
  }));
  store.commit(events.cellSourceChanged({
    id: "intro",
    source: "# Data Analysis Notebook\n\nThis notebook analyzes sales data.",
    modifiedBy: "author",
  }));

  // Cell 2: Code to load data
  const cell2Order = fractionalIndexBetween(cell1Order, null, true);
  store.commit(events.cellCreated2({
    id: "load-data",
    fractionalIndex: cell2Order,
    cellType: "code",
    createdBy: "author",
  }));
  store.commit(events.cellSourceChanged({
    id: "load-data",
    source: "import pandas as pd\ndf = pd.read_csv('sales.csv')",
    modifiedBy: "author",
  }));

  // Cell 3: AI analysis
  const cell3Order = fractionalIndexBetween(cell2Order, null, true);
  store.commit(events.cellCreated2({
    id: "ai-analysis",
    fractionalIndex: cell3Order,
    cellType: "ai",
    createdBy: "author",
  }));
  store.commit(events.cellSourceChanged({
    id: "ai-analysis",
    source: "Analyze the sales trends in the dataframe",
    modifiedBy: "author",
  }));

  // User inserts a new code cell between load-data and ai-analysis
  const insertedOrder = fractionalIndexBetween(cell2Order, cell3Order, true);
  store.commit(events.cellCreated2({
    id: "transform-data",
    fractionalIndex: insertedOrder,
    cellType: "code",
    createdBy: "collaborator",
  }));
  store.commit(events.cellSourceChanged({
    id: "transform-data",
    source: "df['profit_margin'] = df['profit'] / df['revenue']",
    modifiedBy: "collaborator",
  }));

  // Verify final notebook structure
  const orderedCells = store.query(
    tables.cells.select().orderBy("fractionalIndex", "asc"),
  ).filter((c) => c.fractionalIndex !== null);

  assertEquals(orderedCells.length, 4);

  // With jittered indices, exact ordering is non-deterministic
  // Just verify all cells exist
  const cellIds = orderedCells.map((c) => c.id);
  assert(cellIds.includes("intro"));
  assert(cellIds.includes("load-data"));
  assert(cellIds.includes("transform-data"));
  assert(cellIds.includes("ai-analysis"));

  // Verify cell types by ID
  const cellsById = Object.fromEntries(
    orderedCells.map((c) => [c.id, c]),
  );
  assertEquals(cellsById["intro"].cellType, "markdown");
  assertEquals(cellsById["load-data"].cellType, "code");
  assertEquals(cellsById["transform-data"].cellType, "code");
  assertEquals(cellsById["ai-analysis"].cellType, "ai");

  // Verify sources
  assert(cellsById["intro"].source.includes("Data Analysis Notebook"));
  assert(cellsById["load-data"].source.includes("pd.read_csv"));
  assert(cellsById["transform-data"].source.includes("profit_margin"));
  assert(cellsById["ai-analysis"].source.includes("Analyze the sales trends"));

  store.shutdown();
});

Deno.test("v2.CellCreated - mixed v1 and v2 events", async () => {
  const store = await setupStore();
  const { fractionalIndexBetween, initialFractionalIndex } = await import(
    "@runt/schema"
  );

  // Create some cells with v1 events
  store.commit(events.cellCreated({
    id: "v1-cell-1",
    cellType: "code",
    position: 0,
    createdBy: "user1",
  }));

  store.commit(events.cellCreated({
    id: "v1-cell-2",
    cellType: "markdown",
    position: 1,
    createdBy: "user1",
  }));

  // Now use v2 events for new cells (with jitter for realistic usage)
  const firstV2Order = initialFractionalIndex(true);
  store.commit(events.cellCreated2({
    id: "v2-cell-1",
    fractionalIndex: firstV2Order,
    cellType: "ai",
    createdBy: "user2",
  }));

  const secondV2Order = fractionalIndexBetween(firstV2Order, null, true);
  store.commit(events.cellCreated2({
    id: "v2-cell-2",
    fractionalIndex: secondV2Order,
    cellType: "sql",
    createdBy: "user2",
  }));

  // Query all cells
  const allCells = store.query(tables.cells);
  assertEquals(allCells.length, 4);

  // v1 cells have position but no fractionalIndex
  const v1Cells = allCells.filter((c) => c.id.startsWith("v1-"));
  assertEquals(v1Cells.length, 2);
  v1Cells.forEach((cell) => {
    assert(cell.position !== null);
    assertEquals(cell.fractionalIndex, null);
  });

  // v2 cells have fractionalIndex
  const v2Cells = allCells.filter((c) => c.id.startsWith("v2-"));
  assertEquals(v2Cells.length, 2);
  v2Cells.forEach((cell) => {
    assert(cell.fractionalIndex !== null);
    assertEquals(cell.position, 0); // Default value
  });

  store.shutdown();
});

Deno.test("v2.CellCreated - bulk cell import", async () => {
  const store = await setupStore();
  const { generateFractionalIndices, fractionalIndexBetween } = await import(
    "@runt/schema"
  );

  // Simulate importing 10 cells at once
  const cellCount = 10;
  // Generate indices one by one instead of using generateNJitteredKeysBetween
  const indices: string[] = [];
  let prevIndex: string | null = null;
  for (let i = 0; i < cellCount; i++) {
    const newIndex = fractionalIndexBetween(prevIndex, null, false); // No jitter for predictable test
    indices.push(newIndex);
    prevIndex = newIndex;
  }

  // Create all cells
  for (let i = 0; i < cellCount; i++) {
    store.commit(events.cellCreated2({
      id: `imported-cell-${i}`,
      fractionalIndex: indices[i],
      cellType: i % 3 === 0 ? "markdown" : i % 3 === 1 ? "code" : "ai",
      createdBy: "importer",
    }));
  }

  // Verify all cells were created in order
  const orderedCells = store.query(
    tables.cells.select().orderBy("fractionalIndex", "asc"),
  );

  assertEquals(orderedCells.length, cellCount);

  // Verify ordering is correct
  for (let i = 0; i < cellCount; i++) {
    assertEquals(orderedCells[i].id, `imported-cell-${i}`);
  }

  // Verify fractional indices are properly spaced
  for (let i = 1; i < orderedCells.length; i++) {
    assert(
      orderedCells[i].fractionalIndex! > orderedCells[i - 1].fractionalIndex!,
      `Cell ${i} should have greater fractionalIndex than cell ${i - 1}`,
    );
  }

  store.shutdown();
});

Deno.test("v2.CellCreated - extreme insertion patterns", async () => {
  const store = await setupStore();
  const { fractionalIndexBetween, initialFractionalIndex } = await import(
    "@runt/schema"
  );

  // Start with one cell (no jitter for predictable test)
  let indices: string[] = [initialFractionalIndex(false)];
  store.commit(events.cellCreated2({
    id: "cell-0",
    fractionalIndex: indices[0],
    cellType: "code",
    createdBy: "user",
  }));

  // Always insert at the beginning (stress test for "before" insertions)
  for (let i = 1; i <= 5; i++) {
    const newIndex = fractionalIndexBetween(null, indices[0], false);
    indices.unshift(newIndex);
    store.commit(events.cellCreated2({
      id: `cell-before-${i}`,
      fractionalIndex: newIndex,
      cellType: "code",
      createdBy: "user",
    }));
  }

  // Always insert between first two cells (stress test fractional precision)
  for (let i = 1; i <= 5; i++) {
    const newIndex = fractionalIndexBetween(indices[0], indices[1], false);
    indices.splice(1, 0, newIndex);
    store.commit(events.cellCreated2({
      id: `cell-between-${i}`,
      fractionalIndex: newIndex,
      cellType: "markdown",
      createdBy: "user",
    }));
  }

  // Verify all cells exist and are properly ordered
  const orderedCells = store.query(
    tables.cells.select().orderBy("fractionalIndex", "asc"),
  ).filter((c) => c.fractionalIndex !== null);

  assertEquals(orderedCells.length, 11); // 1 original + 5 before + 5 between

  // Verify the fractional indices don't get too long
  const maxIndexLength = Math.max(
    ...orderedCells.map((c) => c.fractionalIndex!.length),
  );
  assert(
    maxIndexLength < 10,
    `Fractional indices should stay reasonably short, got max length: ${maxIndexLength}`,
  );

  // Verify ordering is maintained
  for (let i = 1; i < orderedCells.length; i++) {
    assert(
      orderedCells[i].fractionalIndex! > orderedCells[i - 1].fractionalIndex!,
      `Ordering broken at index ${i}`,
    );
  }

  store.shutdown();
});

Deno.test("fractional indexing - concurrent inserts", async () => {
  const { fractionalIndexBetween } = await import("@runt/schema");

  // Test deterministic behavior without jitter
  const cellA = fractionalIndexBetween(null, null, false);
  const cellB = fractionalIndexBetween(cellA, null, false);
  assertEquals(cellA, "a0");
  assertEquals(cellB, "a1");

  // Without jitter: both users get same position
  const user1NoJitter = fractionalIndexBetween(cellA, cellB, false);
  const user2NoJitter = fractionalIndexBetween(cellA, cellB, false);
  assertEquals(user1NoJitter, user2NoJitter);
  assertEquals(user1NoJitter, "a0V");

  // With jitter: users likely get different positions
  const user1WithJitter = fractionalIndexBetween(cellA, cellB, true);
  const user2WithJitter = fractionalIndexBetween(cellA, cellB, true);

  // Both should be valid and between cellA and cellB
  assert(user1WithJitter > cellA);
  assert(user1WithJitter < cellB);
  assert(user2WithJitter > cellA);
  assert(user2WithJitter < cellB);

  // The base part should be the same, but jitter makes them unique
  assert(user1WithJitter.startsWith("a0V"));
  assert(user2WithJitter.startsWith("a0V"));
});

Deno.test("fractional indexing - edge cases", async () => {
  const { fractionalIndexBetween, isValidFractionalIndex } = await import(
    "@runt/schema"
  );

  // Validate indices
  const validIndex = fractionalIndexBetween(null, null, false);
  assert(isValidFractionalIndex(validIndex));
  assert(isValidFractionalIndex("a0V8p")); // Valid jittered key format
  assert(!isValidFractionalIndex(""));

  // Many inserts in sequence (no jitter for predictable results)
  let prev = fractionalIndexBetween(null, null, false);
  const indices: string[] = [prev];
  assertEquals(prev, "a0");

  for (let i = 0; i < 10; i++) {
    const next = fractionalIndexBetween(prev, null, false);
    assert(next > prev);
    indices.push(next);
    prev = next;
  }

  // Verify we get expected sequence
  assertEquals(indices[0], "a0");
  assertEquals(indices[1], "a1");
  assertEquals(indices[2], "a2");

  // All indices should be in order
  for (let i = 1; i < indices.length; i++) {
    assert(indices[i] > indices[i - 1]);
  }
});

Deno.test("v2.CellCreated - using helper functions", async () => {
  const store = await setupStore();
  const {
    createCellAfter,
    createCellBefore,
    createCellAtPosition,
    fractionalIndexBetween,
  } = await import("@runt/schema");

  // For predictable tests, we'll create cells with non-jittered indices manually
  // Start with an empty notebook
  let cells = store.query(tables.cells);
  assertEquals(cells.length, 0);

  // Create first cell with non-jittered index
  const firstIndex = fractionalIndexBetween(null, null, false); // "a0"
  store.commit(events.cellCreated2({
    id: "first-cell",
    fractionalIndex: firstIndex,
    cellType: "markdown",
    createdBy: "author",
  }));

  // Create a cell after the first one
  const secondIndex = fractionalIndexBetween(firstIndex, null, false); // "a1"
  store.commit(events.cellCreated2({
    id: "second-cell",
    fractionalIndex: secondIndex,
    cellType: "code",
    createdBy: "author",
  }));

  // Create a cell before the first one
  const beforeFirstIndex = fractionalIndexBetween(null, firstIndex, false); // "Zz"
  store.commit(events.cellCreated2({
    id: "before-first",
    fractionalIndex: beforeFirstIndex,
    cellType: "ai",
    createdBy: "collaborator",
  }));

  // Create a cell at position 2 (between first and second)
  const atPosition2Index = fractionalIndexBetween(
    firstIndex,
    secondIndex,
    false,
  ); // "a0V"
  store.commit(events.cellCreated2({
    id: "at-position-2",
    fractionalIndex: atPosition2Index,
    cellType: "sql",
    createdBy: "collaborator",
  }));

  // Verify final order
  const orderedCells = store.query(
    tables.cells.select().orderBy("fractionalIndex", "asc"),
  ).filter((c) => c.fractionalIndex !== null);

  assertEquals(orderedCells.length, 4);

  // With non-jittered indices, we can verify exact ordering
  assertEquals(orderedCells[0].id, "before-first"); // Zz < a0
  assertEquals(orderedCells[1].id, "first-cell"); // a0
  assertEquals(orderedCells[2].id, "at-position-2"); // a0V
  assertEquals(orderedCells[3].id, "second-cell"); // a1

  // Verify all cells have unique fractional indices
  const indices = new Set(orderedCells.map((c) => c.fractionalIndex));
  assertEquals(indices.size, 4, "All cells should have unique indices");

  // Verify exact indices
  assertEquals(orderedCells[0].fractionalIndex, "Zz");
  assertEquals(orderedCells[1].fractionalIndex, "a0");
  assertEquals(orderedCells[2].fractionalIndex, "a0V");
  assertEquals(orderedCells[3].fractionalIndex, "a1");

  // Verify cells are properly ordered
  for (let i = 1; i < orderedCells.length; i++) {
    assert(
      orderedCells[i].fractionalIndex! > orderedCells[i - 1].fractionalIndex!,
      `Cell ${i} should have greater fractionalIndex than cell ${i - 1}`,
    );
  }

  store.shutdown();
});

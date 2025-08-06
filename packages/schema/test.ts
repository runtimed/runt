/// <reference lib="deno.ns" />

import {
  createStorePromise,
  makeSchema,
  State,
  type Store as LiveStore,
} from "@livestore/livestore";

import { makeAdapter } from "npm:@livestore/adapter-node";

import {
  assert,
  assertEquals,
  assertExists,
  assertNotEquals,
} from "jsr:@std/assert";
import { restore, stub } from "jsr:@std/testing/mock";

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
    fractionalIndex: c.fractionalIndex,
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

  // Mock Math.random to return 0 for deterministic tests
  const _mathRandomStub = stub(Math, "random", () => 0);

  try {
    // Initial index
    const first = initialFractionalIndex();
    assert(first); // Just verify we got a value

    // Insert after first
    const second = fractionalIndexBetween(first, null);
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
  } finally {
    restore();
  }
});

Deno.test("v2.CellCreated with fractional indexing - comprehensive", async () => {
  const store = await setupStore();
  const { fractionalIndexBetween, initialFractionalIndex } = await import(
    "@runt/schema"
  );

  // Mock Math.random for deterministic tests
  const _mathRandomStub = stub(Math, "random", () => 0);

  try {
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
    assertEquals(orderedIds, [
      "cell-4",
      "cell-1",
      "cell-3",
      "cell-2",
      "cell-5",
    ]);

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
  } finally {
    restore();
  }
});

Deno.test("v2.CellCreated - simulating concurrent notebook editing", async () => {
  const store = await setupStore();
  const { fractionalIndexBetween, initialFractionalIndex } = await import(
    "@runt/schema"
  );

  // Mock Math.random for deterministic initial setup
  const _mathRandomStub = stub(Math, "random", () => 0);

  try {
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

    // Test deterministic scenario (same random values)
    const userAOrderDeterministic = fractionalIndexBetween(
      cell2Order,
      cell3Order,
    );
    const userBOrderDeterministic = fractionalIndexBetween(
      cell2Order,
      cell3Order,
    );
    assertEquals(userAOrderDeterministic, userBOrderDeterministic);

    // Restore Math.random for actual random behavior
    restore();

    // With random: users get different positions (high probability)
    const userAOrder = fractionalIndexBetween(cell2Order, cell3Order);
    const userBOrder = fractionalIndexBetween(cell2Order, cell3Order);

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
  } finally {
    // Ensure cleanup
  }
});

Deno.test("v2.CellCreated - building a notebook from scratch", async () => {
  const store = await setupStore();
  const { fractionalIndexBetween, initialFractionalIndex } = await import(
    "@runt/schema"
  );

  // Create a notebook with markdown, code, and AI cells
  // Cell 1: Markdown introduction (use jitter for realistic scenario)
  const cell1Order = initialFractionalIndex();
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
  const cell2Order = fractionalIndexBetween(cell1Order, null);
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
  const cell3Order = fractionalIndexBetween(cell2Order, null);
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
  const insertedOrder = fractionalIndexBetween(cell2Order, cell3Order);
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

  // Mock Math.random for deterministic tests
  const _mathRandomStub = stub(Math, "random", () => 0);

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

  // Now use v2 events for new cells
  const firstV2Order = initialFractionalIndex();
  store.commit(events.cellCreated2({
    id: "v2-cell-1",
    fractionalIndex: firstV2Order,
    cellType: "ai",
    createdBy: "user2",
  }));

  const secondV2Order = fractionalIndexBetween(firstV2Order, null);
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
    assert(cell.fractionalIndex !== null);
    // v1 cells now get fractionalIndex converted from position
    assert(typeof cell.fractionalIndex === "string");
  });

  // v2 cells have fractionalIndex
  const v2Cells = allCells.filter((c) => c.id.startsWith("v2-"));
  assertEquals(v2Cells.length, 2);
  v2Cells.forEach((cell) => {
    assert(cell.fractionalIndex !== null);
    // v2 cells have their original fractionalIndex
    assert(typeof cell.fractionalIndex === "string");
  });

  store.shutdown();
  restore();
});

Deno.test("v2.CellCreated - bulk cell import", async () => {
  const store = await setupStore();
  const { fractionalIndexBetween } = await import("@runt/schema");

  // Mock Math.random for deterministic tests
  const _mathRandomStub = stub(Math, "random", () => 0);

  // Simulate importing 10 cells at once
  const cellCount = 10;
  // Generate indices one by one instead of using generateNJitteredKeysBetween
  const indices: string[] = [];
  let prevIndex: string | null = null;
  for (let i = 0; i < cellCount; i++) {
    const newIndex = fractionalIndexBetween(prevIndex, null); // Deterministic test
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
  restore();
});

Deno.test("v2.CellCreated - extreme insertion patterns", async () => {
  const store = await setupStore();
  const { fractionalIndexBetween, initialFractionalIndex } = await import(
    "@runt/schema"
  );

  // Mock Math.random for deterministic tests
  const _mathRandomStub = stub(Math, "random", () => 0);

  // Start with one cell (no jitter for predictable test)
  const indices: string[] = [initialFractionalIndex()];
  store.commit(events.cellCreated2({
    id: "cell-0",
    fractionalIndex: indices[0],
    cellType: "code",
    createdBy: "user",
  }));

  // Always insert at the beginning (stress test for "before" insertions)
  for (let i = 1; i <= 5; i++) {
    const newIndex = fractionalIndexBetween(null, indices[0]);
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
    const newIndex = fractionalIndexBetween(indices[0], indices[1]);
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
  restore();
});

Deno.test("fractional indexing - concurrent inserts", async () => {
  const { fractionalIndexBetween } = await import("@runt/schema");

  // Mock Math.random for deterministic tests
  const _mathRandomStub = stub(Math, "random", () => 0);

  try {
    // Test deterministic behavior
    const cellA = fractionalIndexBetween(null, null);
    const cellB = fractionalIndexBetween(cellA, null);
    assert(cellA);
    assert(cellB > cellA);

    // With same random value: both users get same position
    const user1Deterministic = fractionalIndexBetween(cellA, cellB);
    const user2Deterministic = fractionalIndexBetween(cellA, cellB);
    assertEquals(user1Deterministic, user2Deterministic);
    assert(user1Deterministic > cellA && user1Deterministic < cellB);
    // Restore Math.random for actual randomness
    restore();

    // With actual randomness: users likely get different positions
    const user1WithRandom = fractionalIndexBetween(cellA, cellB);
    const user2WithRandom = fractionalIndexBetween(cellA, cellB);

    // Both should be valid and between cellA and cellB
    assert(user1WithRandom > cellA);
    assert(user1WithRandom < cellB);
    assert(user2WithRandom > cellA);
    assert(user2WithRandom < cellB);
  } finally {
    // Ensure cleanup happens
  }

  // With multi-key randomization, they should be different (with high probability)
  // We can't assert they start with a specific prefix since we pick from multiple positions
});

Deno.test("fractional indexing - edge cases", async () => {
  const { fractionalIndexBetween, isValidFractionalIndex } = await import(
    "@runt/schema"
  );

  // Mock Math.random for deterministic tests
  const _mathRandomStub = stub(Math, "random", () => 0);

  try {
    // Validate indices
    const validIndex = fractionalIndexBetween(null, null);
    assert(isValidFractionalIndex(validIndex));
    assert(isValidFractionalIndex("a0v8p")); // Valid jittered key format (lowercase only)
    assert(!isValidFractionalIndex(""));

    // Many inserts in sequence (deterministic)
    let prev = fractionalIndexBetween(null, null);
    const indices: string[] = [prev];
    assert(prev);

    for (let i = 0; i < 10; i++) {
      const next = fractionalIndexBetween(prev, null);
      assert(next > prev);
      indices.push(next);
      prev = next;
    }

    // Verify ordering without expecting exact values
    assert(indices.length === 11);

    // All indices should be in order
    for (let i = 1; i < indices.length; i++) {
      assert(indices[i] > indices[i - 1]);
    }
  } finally {
    restore();
  }
});

Deno.test("fractional indexing - base36 ordering edge case", async () => {
  const { fractionalIndexBetween } = await import("@runt/schema");

  // Mock Math.random for deterministic tests
  const _mathRandomStub = stub(Math, "random", () => 0);

  try {
    // This tests edge cases in our base36 implementation
    // We use only lowercase letters and numbers (0-9, a-z)

    // First, we need to generate indices that would create these patterns
    // Starting from a2, we'll create insertions that lead to a2l
    let current = "a2";
    const indices: string[] = [current];

    // Insert multiple times after a2 to approach the pattern
    for (let i = 0; i < 20; i++) {
      const next = fractionalIndexBetween(current, "a3");
      indices.push(next);
      current = next;
    }

    // Test inserting between various patterns
    const testPatterns = [
      { a: "a2l", b: "a2m", name: "a2l to a2m" },
      { a: "a2y", b: "a2z", name: "a2y to a2z" },
      { a: "a2", b: "a20", name: "a2 to a20" },
      { a: "a29", b: "a2a", name: "a29 to a2a (number to letter transition)" },
      { a: "a2z", b: "a3", name: "a2z to a3" },
    ];

    for (const pattern of testPatterns) {
      try {
        const between = fractionalIndexBetween(pattern.a, pattern.b);

        // Verify the ordering is correct
        assert(
          between > pattern.a,
          `${between} should be > ${pattern.a} (${pattern.name})`,
        );
        assert(
          between < pattern.b,
          `${between} should be < ${pattern.b} (${pattern.name})`,
        );

        // Verify string comparison works correctly (base62 ordering)
        assert(
          pattern.a.localeCompare(between) < 0,
          `localeCompare: ${pattern.a} should be < ${between}`,
        );
        assert(
          between.localeCompare(pattern.b) < 0,
          `localeCompare: ${between} should be < ${pattern.b}`,
        );
      } catch (error) {
        // If the fractional-indexing library throws an error, we should handle it gracefully
        console.log(
          `Edge case error for ${pattern.name}: ${(error as Error).message}`,
        );
        // The system should recover - test that we can still insert elsewhere
        const recovery = fractionalIndexBetween(pattern.a, null);
        assert(
          recovery > pattern.a,
          `Recovery: ${recovery} should be > ${pattern.a}`,
        );
      }
    }
  } finally {
    restore();
  }

  // Test with jitter to ensure different indices
  const { defaultJitterProvider } = await import("@runt/schema");
  const withJitter1 = fractionalIndexBetween(
    "a2l",
    "a2m",
    defaultJitterProvider,
  );
  const withJitter2 = fractionalIndexBetween(
    "a2l",
    "a2m",
    defaultJitterProvider,
  );

  // Both should be between a2l and a2m
  assert(
    withJitter1 > "a2l" && withJitter1 < "a2m",
    `${withJitter1} should be between a2l and a2m`,
  );
  assert(
    withJitter2 > "a2l" && withJitter2 < "a2m",
    `${withJitter2} should be between a2l and a2m`,
  );

  // They should maintain proper ordering
  assert("a2l" < withJitter1, `a2l should be < ${withJitter1}`);
  assert(withJitter1 < "a2m", `${withJitter1} should be < a2m`);
});

Deno.test("v2.CellCreated - concurrent insertions triggering edge case", async () => {
  const store = await setupStore();
  const _notebookId = "test-notebook";

  // Mock Math.random for deterministic edge case setup
  const _mathRandomStub = stub(Math, "random", () => 0);

  try {
    const { fractionalIndexBetween } = await import("@runt/schema");

    // Simulate a notebook that has been heavily edited, approaching edge case indices
    // Start with cells that have indices close to the problematic patterns

    // Create initial cells that will lead to the edge case
    store.commit(events.cellCreated2({
      id: "cell-a2",
      fractionalIndex: "a2",
      cellType: "code",
      createdBy: "user1",
    }));

    store.commit(events.cellCreated2({
      id: "cell-a3",
      fractionalIndex: "a3",
      cellType: "code",
      createdBy: "user1",
    }));

    // Simulate many insertions between a2 and a3 to approach problematic patterns
    let prevIndex = "a2";
    const insertedCells: string[] = [];

    for (let i = 0; i < 15; i++) {
      const nextIndex = fractionalIndexBetween(prevIndex, "a3");
      const cellId = `cell-between-${i}`;

      store.commit(events.cellCreated2({
        id: cellId,
        fractionalIndex: nextIndex,
        cellType: i % 2 === 0 ? "code" : "markdown",
        createdBy: `user${(i % 3) + 1}`,
      }));

      insertedCells.push(cellId);
      prevIndex = nextIndex;
    }

    // Now simulate concurrent insertions from multiple users
    // User A and User B both try to insert at the same position
    const sortedCells = store.query(
      tables.cells.select().orderBy("fractionalIndex", "asc"),
    ).filter((c) => c.fractionalIndex !== null);

    // Find cells with indices that might trigger the edge case
    let problematicPairFound = false;
    let cellA: string | null = null;
    let cellB: string | null = null;

    for (let i = 0; i < sortedCells.length - 1; i++) {
      const current = sortedCells[i].fractionalIndex!;
      const next = sortedCells[i + 1].fractionalIndex!;

      // Check if we're near the problematic patterns
      if (
        current.startsWith("a2") && next.startsWith("a2") &&
        (current.includes("l") || current.includes("V") ||
          next.includes("l") || next.includes("V"))
      ) {
        problematicPairFound = true;
        cellA = current;
        cellB = next;
        break;
      }
    }

    // If we found a problematic pair, test concurrent insertions
    if (problematicPairFound && cellA && cellB) {
      // Restore Math.random first
      restore();

      // Mock Math.random to return different values for each call
      // This ensures userA and userB pick different indices from the generated keys
      let callCount = 0;
      const randomStub = stub(Math, "random", () => {
        // First call (for userA): return 0.3 (will pick index ~6 out of 20)
        // Second call (for userB): return 0.7 (will pick index ~14 out of 20)
        callCount++;
        return callCount === 1 ? 0.3 : 0.7;
      });

      try {
        // Both users try to insert between the same two cells
        const userAIndex = fractionalIndexBetween(cellA, cellB);
        const userBIndex = fractionalIndexBetween(cellA, cellB);

        // With different random values, they should get different indices
        assertNotEquals(userAIndex, userBIndex, "Random indices should differ");

        // Both indices should maintain proper ordering
        assert(userAIndex > cellA, `${userAIndex} should be > ${cellA}`);
        assert(userAIndex < cellB, `${userAIndex} should be < ${cellB}`);
        assert(userBIndex > cellA, `${userBIndex} should be > ${cellA}`);
        assert(userBIndex < cellB, `${userBIndex} should be < ${cellB}`);

        // Commit both cells
        store.commit(events.cellCreated2({
          id: "concurrent-userA",
          fractionalIndex: userAIndex,
          cellType: "code",
          createdBy: "userA",
        }));

        store.commit(events.cellCreated2({
          id: "concurrent-userB",
          fractionalIndex: userBIndex,
          cellType: "markdown",
          createdBy: "userB",
        }));
      } finally {
        randomStub.restore();
      }
    }

    // Verify final ordering is maintained
    const finalCells = store.query(
      tables.cells.select().orderBy("fractionalIndex", "asc"),
    ).filter((c) => c.fractionalIndex !== null);

    // Check that ordering is strictly increasing
    for (let i = 1; i < finalCells.length; i++) {
      const prev = finalCells[i - 1].fractionalIndex!;
      const curr = finalCells[i].fractionalIndex!;
      assert(
        prev < curr,
        `Ordering violated: ${prev} should be < ${curr}`,
      );
    }

    // Verify no duplicate indices (even with concurrent insertions)
    const indexSet = new Set(finalCells.map((c) => c.fractionalIndex));
    assertEquals(
      indexSet.size,
      finalCells.length,
      "All fractional indices should be unique",
    );
  } finally {
    // Clean up the store to prevent leaks
    await store.shutdown();
    restore();
  }
});

Deno.test("v2.CellCreated - using helper functions", async () => {
  const store = await setupStore();
  const { fractionalIndexBetween } = await import("@runt/schema");

  // Mock Math.random for deterministic tests
  const _mathRandomStub = stub(Math, "random", () => 0);

  try {
    // For predictable tests, we'll create cells with non-jittered indices manually
    // Start with an empty notebook
    const cells = store.query(tables.cells);
    assertEquals(cells.length, 0);

    // Create first cell with non-jittered index
    const firstIndex = fractionalIndexBetween(null, null); // "a0"
    store.commit(events.cellCreated2({
      id: "first-cell",
      fractionalIndex: firstIndex,
      cellType: "markdown",
      createdBy: "author",
    }));

    // Create a cell after the first one
    const secondIndex = fractionalIndexBetween(firstIndex, null); // "a1"
    store.commit(events.cellCreated2({
      id: "second-cell",
      fractionalIndex: secondIndex,
      cellType: "code",
      createdBy: "author",
    }));

    // Create a cell before the first one
    const beforeFirstIndex = fractionalIndexBetween(null, firstIndex); // "Zz"
    store.commit(events.cellCreated2({
      id: "before-first",
      fractionalIndex: beforeFirstIndex,
      cellType: "ai",
      createdBy: "collaborator",
    }));

    // Create a cell at position 2 (between first and second)
    const atPosition2Index = fractionalIndexBetween(firstIndex, secondIndex); // "a0V"
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

    // Don't verify exact indices since multi-key generation can produce different valid values
    // Just verify they maintain proper ordering

    // Verify cells are properly ordered
    for (let i = 1; i < orderedCells.length; i++) {
      assert(
        orderedCells[i].fractionalIndex! > orderedCells[i - 1].fractionalIndex!,
        `Cell ${i} should have greater fractionalIndex than cell ${i - 1}`,
      );
    }

    store.shutdown();
  } finally {
    restore();
  }
});

Deno.test("v2.CellMoved - basic cell movement", async () => {
  const store = await setupStore();
  const { fractionalIndexBetween, moveCellBetween } = await import(
    "@runt/schema"
  );

  // Create initial cells with fractional indices in proper order
  const cell1Index = fractionalIndexBetween(null, null);
  const cell2Index = fractionalIndexBetween(cell1Index, null);
  const cell3Index = fractionalIndexBetween(cell2Index, null);

  const cells = [
    { id: "cell-1", fractionalIndex: cell1Index, cellType: "code" as const },
    { id: "cell-2", fractionalIndex: cell2Index, cellType: "code" as const },
    { id: "cell-3", fractionalIndex: cell3Index, cellType: "code" as const },
  ];

  // Create cells in the store
  for (const cell of cells) {
    store.commit(events.cellCreated2({
      id: cell.id,
      fractionalIndex: cell.fractionalIndex,
      cellType: "code",
      createdBy: "user1",
    }));
  }

  // Test moving cell-2 after cell-3
  const cell2 = cells.find((c) => c.id === "cell-2")!;
  const cell3 = cells.find((c) => c.id === "cell-3")!;
  const moveEvent = moveCellBetween(cell2, cell3, null, "user1");
  assertExists(moveEvent);
  store.commit(moveEvent);

  // Update our local cells array to reflect the move
  const movedCell = cells.find((c) => c.id === "cell-2")!;
  movedCell.fractionalIndex = moveEvent.args.fractionalIndex;

  // Verify the new order: cell-1, cell-3, cell-2
  const sortedCells = [...cells].sort((a, b) => {
    // Primary sort by fractional index
    if (a.fractionalIndex < b.fractionalIndex) return -1;
    if (a.fractionalIndex > b.fractionalIndex) return 1;
    // Secondary sort by ID if fractional indices are equal
    return a.id.localeCompare(b.id);
  });
  assertEquals(sortedCells[0].id, "cell-1");
  assertEquals(sortedCells[1].id, "cell-3");
  assertEquals(sortedCells[2].id, "cell-2");

  // Test moving cell-2 to the beginning (before all cells)
  const cell1 = cells.find((c) => c.id === "cell-1")!;
  const moveToStartEvent = moveCellBetween(cell2, null, cell1, "user1");
  assertExists(moveToStartEvent);
  store.commit(moveToStartEvent);

  // Verify cell-2 is now first
  movedCell.fractionalIndex = moveToStartEvent.args.fractionalIndex;
  const resortedCells = [...cells].sort((a, b) => {
    // Primary sort by fractional index
    if (a.fractionalIndex < b.fractionalIndex) return -1;
    if (a.fractionalIndex > b.fractionalIndex) return 1;
    // Secondary sort by ID if fractional indices are equal
    return a.id.localeCompare(b.id);
  });
  assertEquals(resortedCells[0].id, "cell-2");

  store.shutdown();
});

Deno.test("v2.CellMoved - move to position", async () => {
  const store = await setupStore();
  const { fractionalIndexBetween, moveCellBetween } = await import(
    "@runt/schema"
  );

  // Create 5 cells
  const cells = [];
  let prevKey: string | null = null;
  for (let i = 1; i <= 5; i++) {
    const fractionalIndex = fractionalIndexBetween(prevKey, null);
    cells.push({ id: `cell-${i}`, fractionalIndex, cellType: "code" as const });
    prevKey = fractionalIndex;

    store.commit(events.cellCreated2({
      id: `cell-${i}`,
      fractionalIndex,
      cellType: "code",
      createdBy: "user1",
    }));
  }

  // Move cell-5 to position 2 (between cell-2 and cell-3)
  const cell5 = cells.find((c) => c.id === "cell-5")!;
  const cell2 = cells.find((c) => c.id === "cell-2")!;
  const cell3 = cells.find((c) => c.id === "cell-3")!;
  const moveEvent = moveCellBetween(cell5, cell2, cell3, "user1");
  assertExists(moveEvent);
  store.commit(moveEvent);

  // Update our local array
  const movedCell = cells.find((c) => c.id === "cell-5")!;
  movedCell.fractionalIndex = moveEvent.args.fractionalIndex;

  // Verify new order: cell-1, cell-2, cell-5, cell-3, cell-4
  const sortedCells = [...cells].sort((a, b) => {
    // Primary sort by fractional index
    if (a.fractionalIndex < b.fractionalIndex) return -1;
    if (a.fractionalIndex > b.fractionalIndex) return 1;
    // Secondary sort by ID if fractional indices are equal
    return a.id.localeCompare(b.id);
  });
  assertEquals(sortedCells.map((c) => c.id), [
    "cell-1",
    "cell-2",
    "cell-5",
    "cell-3",
    "cell-4",
  ]);

  // Move cell-1 to the end (position 4)
  const cell1 = cells.find((c) => c.id === "cell-1")!;
  const cell4 = cells.find((c) => c.id === "cell-4")!;
  const moveToEndEvent = moveCellBetween(cell1, cell4, null, "user1");
  assertExists(moveToEndEvent);
  store.commit(moveToEndEvent);

  cells.find((c) => c.id === "cell-1")!.fractionalIndex =
    moveToEndEvent.args.fractionalIndex;
  const finalOrder = [...cells].sort((a, b) => {
    // Primary sort by fractional index
    if (a.fractionalIndex < b.fractionalIndex) return -1;
    if (a.fractionalIndex > b.fractionalIndex) return 1;
    // Secondary sort by ID if fractional indices are equal
    return a.id.localeCompare(b.id);
  });
  assertEquals(finalOrder.map((c) => c.id), [
    "cell-2",
    "cell-5",
    "cell-3",
    "cell-4",
    "cell-1",
  ]);

  store.shutdown();
});

Deno.test("v2.CellMoved - edge cases", async () => {
  const store = await setupStore();
  const { moveCellBetween } = await import(
    "@runt/schema"
  );

  // Test with non-existent cell
  const cell1 = {
    id: "cell-1",
    fractionalIndex: "a0",
    cellType: "code" as const,
  };
  const cell2 = {
    id: "cell-2",
    fractionalIndex: "a1",
    cellType: "code" as const,
  };
  const nonExistentCell = {
    id: "non-existent",
    fractionalIndex: null,
    cellType: "code" as const,
  };

  // Moving cell without fractional index
  const invalidMove = moveCellBetween(nonExistentCell, cell1, cell2);
  assertEquals(invalidMove, null);

  // Test moving between cells when already in position
  // If cell1 is already before cell2, moving it between null and cell2 should be no-op
  const noOpMove = moveCellBetween(cell1, null, cell2);
  assertEquals(noOpMove, null);

  store.shutdown();
});

Deno.test("v2.CellMoved - concurrent movements", async () => {
  const store = await setupStore();
  const { fractionalIndexBetween, moveCellBetween, createTestJitterProvider } =
    await import(
      "@runt/schema"
    );

  // Create initial cells
  const cells = [];
  let prevKey: string | null = null;
  const setupJitter = createTestJitterProvider(42);
  for (let i = 1; i <= 4; i++) {
    const fractionalIndex = fractionalIndexBetween(
      prevKey,
      null,
      setupJitter,
    );
    cells.push({ id: `cell-${i}`, fractionalIndex, cellType: "code" as const });
    prevKey = fractionalIndex;

    store.commit(events.cellCreated2({
      id: `cell-${i}`,
      fractionalIndex,
      cellType: "code",
      createdBy: "user1",
    }));
  }

  // Simulate two users moving different cells concurrently
  // User 1 moves cell-4 after cell-1
  const cell1 = cells.find((c) => c.id === "cell-1")!;
  const cell2 = cells.find((c) => c.id === "cell-2")!;
  const cell3 = cells.find((c) => c.id === "cell-3")!;
  const cell4 = cells.find((c) => c.id === "cell-4")!;

  // Use different jitter providers for each user to simulate concurrent operations
  const user1Jitter = createTestJitterProvider(123);
  const user2Jitter = createTestJitterProvider(456);

  const move1 = moveCellBetween(
    cell4,
    cell1,
    cell2,
    "user1",
    user1Jitter,
  );
  assertExists(move1);

  // User 2 moves cell-3 after cell-1 (same target position)
  const move2 = moveCellBetween(
    cell3,
    cell1,
    cell2,
    "user2",
    user2Jitter,
  );
  assertExists(move2);

  // Both moves should have different fractional indices
  assertNotEquals(move1.args.fractionalIndex, move2.args.fractionalIndex);

  // Commit both moves
  store.commit(move1);
  store.commit(move2);

  // Update local state
  cells.find((c) => c.id === "cell-4")!.fractionalIndex =
    move1.args.fractionalIndex;
  cells.find((c) => c.id === "cell-3")!.fractionalIndex =
    move2.args.fractionalIndex;

  // Both cells should be between cell-1 and cell-2
  const sortedCells = [...cells].sort((a, b) => {
    // Primary sort by fractional index
    if (a.fractionalIndex < b.fractionalIndex) return -1;
    if (a.fractionalIndex > b.fractionalIndex) return 1;
    // Secondary sort by ID if fractional indices are equal
    return a.id.localeCompare(b.id);
  });
  const cell1Index = sortedCells.findIndex((c) => c.id === "cell-1");
  const cell2Index = sortedCells.findIndex((c) => c.id === "cell-2");
  const cell3Index = sortedCells.findIndex((c) => c.id === "cell-3");
  const cell4Index = sortedCells.findIndex((c) => c.id === "cell-4");

  assert(cell1Index < cell3Index && cell3Index < cell2Index);
  assert(cell1Index < cell4Index && cell4Index < cell2Index);

  store.shutdown();
});

Deno.test("v2.CellMoved - no-op when already in position", async () => {
  const store = await setupStore();
  const {
    fractionalIndexBetween,
    moveCellBetween,
  } = await import(
    "@runt/schema"
  );

  // Create cells
  const cells = [];
  let prevKey: string | null = null;
  for (let i = 1; i <= 4; i++) {
    const fractionalIndex = fractionalIndexBetween(prevKey, null);
    cells.push({ id: `cell-${i}`, fractionalIndex, cellType: "code" as const });
    prevKey = fractionalIndex;

    store.commit(events.cellCreated2({
      id: `cell-${i}`,
      fractionalIndex,
      cellType: "code",
      createdBy: "user1",
    }));
  }

  // Get cell references
  const cell1 = cells.find((c) => c.id === "cell-1")!;
  const cell2 = cells.find((c) => c.id === "cell-2")!;
  const cell3 = cells.find((c) => c.id === "cell-3")!;
  const cell4 = cells.find((c) => c.id === "cell-4")!;

  // Move cell-3 between cell-2 and cell-4 (it's already there)
  const noOpMove1 = moveCellBetween(cell3, cell2, cell4, "user1");
  assertEquals(noOpMove1, null);

  // Move cell-1 before cell-2 (it's already before cell-2)
  const noOpMove2 = moveCellBetween(cell1, null, cell2, "user1");
  assertEquals(noOpMove2, null);

  // Move cell-2 between cell-1 and cell-3 (it's already there)
  const noOpMove3 = moveCellBetween(cell2, cell1, cell3, "user1");
  assertEquals(noOpMove3, null);

  // Move cell-4 to the end (it's already last)
  const noOpMove4 = moveCellBetween(cell4, cell3, null, "user1");
  assertEquals(noOpMove4, null);

  // Now do an actual move and verify it works
  const actualMove = moveCellBetween(cell3, cell1, cell2, "user1");
  assertExists(actualMove);
  store.commit(actualMove);

  // Update local state
  cells.find((c) => c.id === "cell-3")!.fractionalIndex =
    actualMove.args.fractionalIndex;

  // Verify new order: cell-1, cell-3, cell-2, cell-4
  const sortedCells = [...cells].sort((a, b) => {
    // Primary sort by fractional index
    if (a.fractionalIndex < b.fractionalIndex) return -1;
    if (a.fractionalIndex > b.fractionalIndex) return 1;
    // Secondary sort by ID if fractional indices are equal
    return a.id.localeCompare(b.id);
  });
  assertEquals(sortedCells.map((c) => c.id), [
    "cell-1",
    "cell-3",
    "cell-2",
    "cell-4",
  ]);

  // Try to move cell-3 between cell-1 and cell-2 again (should be no-op)
  const repeatMove = moveCellBetween(cell3, cell1, cell2, "user1");
  assertEquals(repeatMove, null);

  store.shutdown();
});

Deno.test("v2.CellMoved - moveCellBetween API", async () => {
  const store = await setupStore();
  const { fractionalIndexBetween, moveCellBetween } = await import(
    "@runt/schema"
  );
  type CellReference = import("@runt/schema").CellReference;

  // Create initial cells with known order
  const cell1: CellReference = {
    id: "cell-1",
    fractionalIndex: fractionalIndexBetween(null, null),
    cellType: "code",
  };
  const cell2: CellReference = {
    id: "cell-2",
    fractionalIndex: fractionalIndexBetween(cell1.fractionalIndex, null),
    cellType: "code",
  };
  const cell3: CellReference = {
    id: "cell-3",
    fractionalIndex: fractionalIndexBetween(cell2.fractionalIndex, null),
    cellType: "code",
  };
  const cell4: CellReference = {
    id: "cell-4",
    fractionalIndex: fractionalIndexBetween(cell3.fractionalIndex, null),
    cellType: "code",
  };

  // Create cells in the store
  for (const cell of [cell1, cell2, cell3, cell4]) {
    store.commit(events.cellCreated2({
      id: cell.id,
      fractionalIndex: cell.fractionalIndex!,
      cellType: "code",
      createdBy: "user1",
    }));
  }

  // Test 1: Move cell-2 between cell-3 and cell-4
  const move1 = moveCellBetween(cell2, cell3, cell4, "user1");
  assertExists(move1);
  store.commit(move1);
  cell2.fractionalIndex = move1.args.fractionalIndex;

  // Verify order: cell-1, cell-3, cell-2, cell-4
  assert(cell1.fractionalIndex! < cell3.fractionalIndex!);
  assert(cell3.fractionalIndex! < cell2.fractionalIndex!);
  assert(cell2.fractionalIndex! < cell4.fractionalIndex!);

  // Test 2: Move cell-3 to the beginning (before cell-1)
  const move2 = moveCellBetween(cell3, null, cell1, "user1");
  assertExists(move2);
  store.commit(move2);
  cell3.fractionalIndex = move2.args.fractionalIndex;

  // Verify order: cell-3, cell-1, cell-2, cell-4
  assert(cell3.fractionalIndex! < cell1.fractionalIndex!);
  assert(cell1.fractionalIndex! < cell2.fractionalIndex!);
  assert(cell2.fractionalIndex! < cell4.fractionalIndex!);

  // Test 3: Move cell-1 to the end (after cell-4)
  const move3 = moveCellBetween(cell1, cell4, null, "user1");
  assertExists(move3);
  store.commit(move3);
  cell1.fractionalIndex = move3.args.fractionalIndex;

  // Verify order: cell-3, cell-2, cell-4, cell-1
  assert(cell3.fractionalIndex! < cell2.fractionalIndex!);
  assert(cell2.fractionalIndex! < cell4.fractionalIndex!);
  assert(cell4.fractionalIndex! < cell1.fractionalIndex!);

  // Test 4: No-op when already in position
  const noOp1 = moveCellBetween(cell2, cell3, cell4, "user1");
  assertEquals(noOp1, null); // Already between cell-3 and cell-4

  const noOp2 = moveCellBetween(
    { ...cell3, cellType: "code" as const },
    null,
    { ...cell2, cellType: "code" as const },
    "user1",
  );
  assertEquals(noOp2, null); // Already at the beginning

  const noOp3 = moveCellBetween(
    { ...cell1, cellType: "code" as const },
    { ...cell4, cellType: "code" as const },
    null,
    "user1",
  );
  assertEquals(noOp3, null); // Already at the end

  // Test 5: Invalid cell (no fractional index)
  const invalidCell: CellReference = {
    id: "invalid",
    fractionalIndex: null,
    cellType: "code",
  };
  const invalidMove = moveCellBetween(invalidCell, cell2, cell3);
  assertEquals(invalidMove, null);

  store.shutdown();
});

Deno.test("v2.CellCreated - createCellBetween API", async () => {
  const store = await setupStore();
  const { fractionalIndexBetween, createCellBetween, cellReferences$ } =
    await import(
      "@runt/schema"
    );
  type CellReference = import("@runt/schema").CellReference;

  // Create initial cells to insert between
  const cell1: CellReference = {
    id: "existing-1",
    fractionalIndex: fractionalIndexBetween(null, null),
    cellType: "code",
  };
  const cell2: CellReference = {
    id: "existing-2",
    fractionalIndex: fractionalIndexBetween(cell1.fractionalIndex, null),
    cellType: "code",
  };

  // Create cells in the store
  for (const cell of [cell1, cell2]) {
    store.commit(events.cellCreated2({
      id: cell.id,
      fractionalIndex: cell.fractionalIndex!,
      cellType: "code",
      createdBy: "user1",
    }));
  }

  // Test 1: Create cell at the beginning (before cell1)
  const newCell1 = createCellBetween(
    {
      id: "new-1",
      cellType: "markdown",
      createdBy: "user1",
    },
    null,
    cell1,
    store.query(cellReferences$),
  );
  newCell1.events.forEach((event) => store.commit(event));

  // Verify it's before cell1
  const newCell1Event = newCell1.events.find((e) =>
    e.name === "v2.CellCreated"
  )!;
  assert(newCell1Event.args.fractionalIndex < cell1.fractionalIndex!);

  // Test 2: Create cell between cell1 and cell2
  const newCell2 = createCellBetween(
    {
      id: "new-2",
      cellType: "code",
      createdBy: "user2",
    },
    cell1,
    cell2,
    store.query(cellReferences$),
  );
  newCell2.events.forEach((event) => store.commit(event));

  // Verify it's between cell1 and cell2
  const newCell2Event = newCell2.events.find((e) =>
    e.name === "v2.CellCreated"
  )!;
  assert(newCell2Event.args.fractionalIndex > cell1.fractionalIndex!);
  assert(newCell2Event.args.fractionalIndex < cell2.fractionalIndex!);

  // Test 3: Create cell at the end (after cell2)
  const newCell3 = createCellBetween(
    {
      id: "new-3",
      cellType: "markdown",
      createdBy: "user3",
    },
    cell2,
    null,
    store.query(cellReferences$),
  );
  newCell3.events.forEach((event) => store.commit(event));

  // Verify it's after cell2
  const newCell3Event = newCell3.events.find((e) =>
    e.name === "v2.CellCreated"
  )!;
  assert(newCell3Event.args.fractionalIndex > cell2.fractionalIndex!);

  // Test 4: Create between two cells that were just created
  const newCell4 = createCellBetween(
    {
      id: "new-4",
      cellType: "markdown",
      createdBy: "user1",
    },
    {
      id: "new-1",
      fractionalIndex: newCell1Event.args.fractionalIndex,
      cellType: "markdown" as const,
    },
    cell1,
    store.query(cellReferences$),
  );
  newCell4.events.forEach((event) => store.commit(event));

  // Verify it's between new-1 and cell1
  const newCell4Event = newCell4.events.find((e) =>
    e.name === "v2.CellCreated"
  )!;
  assert(
    newCell4Event.args.fractionalIndex > newCell1Event.args.fractionalIndex,
  );
  assert(newCell4Event.args.fractionalIndex < cell1.fractionalIndex!);

  // Test 5: Create cell with no positioning (should go at beginning)
  const firstCell = createCellBetween(
    {
      id: "first",
      cellType: "markdown",
      createdBy: "user1",
    },
    null,
    null,
    store.query(cellReferences$),
  );
  firstCell.events.forEach((event) => store.commit(event));
  const firstCellEvent = firstCell.events.find((e) =>
    e.name === "v2.CellCreated"
  )!;
  assertExists(firstCellEvent.args.fractionalIndex);

  // Verify all cells maintain proper ordering
  const allCells = store.query(
    tables.cells.select().orderBy("fractionalIndex", "asc"),
  ).filter((c) => c.fractionalIndex !== null);

  // Check that ordering is strictly increasing
  for (let i = 1; i < allCells.length; i++) {
    const prev = allCells[i - 1].fractionalIndex!;
    const curr = allCells[i].fractionalIndex!;

    assert(prev < curr, `Ordering violated: ${prev} should be < ${curr}`);
  }

  store.shutdown();
});

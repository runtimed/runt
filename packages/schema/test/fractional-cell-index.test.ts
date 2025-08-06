/// <reference lib="deno.ns" />

import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type CellReference,
  createCellBetween,
  createTestJitterProvider,
  fractionalIndexBetween,
  generateFractionalIndices,
  initialFractionalIndex,
  isValidFractionalIndex,
  moveCellBetween,
  validateFractionalIndexOrder,
} from "../mod.ts";

Deno.test("Fractional Indexing - Basic Operations", async (t: Deno.TestContext) => {
  await t.step("should generate initial index", () => {
    const index = initialFractionalIndex();
    assertEquals(index.startsWith("m"), true);
    assertEquals(isValidFractionalIndex(index), true);
  });

  await t.step("should generate index between null boundaries", () => {
    const index = fractionalIndexBetween(null, null);
    assertEquals(index.startsWith("m"), true);
    assertEquals(isValidFractionalIndex(index), true);
  });

  await t.step("should generate index before a value", () => {
    const index = fractionalIndexBetween(null, "m");
    assertEquals(index < "m", true);
    assertEquals(isValidFractionalIndex(index), true);
  });

  await t.step("should generate index after a value", () => {
    const index = fractionalIndexBetween("m", null);
    assertEquals(index > "m", true);
    assertEquals(isValidFractionalIndex(index), true);
  });

  await t.step("should generate index between two values", () => {
    const index = fractionalIndexBetween("a", "z");
    assertEquals(index > "a", true);
    assertEquals(index < "z", true);
    assertEquals(isValidFractionalIndex(index), true);
  });

  await t.step("should handle adjacent characters", () => {
    const index = fractionalIndexBetween("a", "b");
    assertEquals(index > "a", true);
    assertEquals(index < "b", true);
    assertEquals(index.length > 1, true); // Should extend
  });

  await t.step("should maintain ordering with binary collation", () => {
    const indices: string[] = [];

    // Use no jitter for this test to avoid ordering conflicts
    const noJitter = { random: () => 0, randomInt: () => 0 };

    // Generate many indices by repeated insertion
    indices.push(fractionalIndexBetween(null, null, noJitter));

    for (let i = 0; i < 100; i++) {
      // Randomly insert between existing indices
      const insertPos = Math.floor(Math.random() * (indices.length + 1));
      const before = insertPos > 0 ? indices[insertPos - 1] : null;
      const after = insertPos < indices.length ? indices[insertPos] : null;

      const newIndex = fractionalIndexBetween(before, after, noJitter);
      indices.splice(insertPos, 0, newIndex);
    }

    // Verify all indices are valid
    indices.forEach((idx) => {
      assertEquals(isValidFractionalIndex(idx), true);
    });

    // Verify ordering is maintained
    const sorted = [...indices].sort();
    assertEquals(indices, sorted);
    assertEquals(validateFractionalIndexOrder(indices), true);
  });
});

Deno.test("Fractional Indexing - Deterministic Testing with JitterProvider", async (t: Deno.TestContext) => {
  await t.step(
    "should generate consistent indices with test jitter provider",
    () => {
      const jitter = createTestJitterProvider(42);

      const index1 = fractionalIndexBetween("a", "z", jitter);

      // Reset with same seed
      const jitter2 = createTestJitterProvider(42);
      const index2 = fractionalIndexBetween("a", "z", jitter2);

      assertEquals(index1, index2);
    },
  );

  await t.step(
    "should generate multiple indices with deterministic jitter",
    () => {
      const jitter = createTestJitterProvider(123);

      const indices = generateFractionalIndices("a", "z", 5, jitter);

      assertEquals(indices.length, 5);
      assertEquals(validateFractionalIndexOrder(["a", ...indices, "z"]), true);

      // Verify deterministic generation
      const jitter2 = createTestJitterProvider(123);
      const indices2 = generateFractionalIndices("a", "z", 5, jitter2);

      assertEquals(indices, indices2);
    },
  );
});

Deno.test("Fractional Indexing - Edge Cases", async (t: Deno.TestContext) => {
  await t.step("should handle very close indices", () => {
    let a = "a";
    let b = "b";

    // Use a no-jitter provider for this test to avoid conflicts
    const noJitter = { random: () => 0, randomInt: () => 0 };

    // Repeatedly insert between a and b
    const indices = [a, b];

    for (let i = 0; i < 20; i++) {
      const mid = fractionalIndexBetween(a, b, noJitter);
      indices.push(mid);

      // Alternately move boundaries closer
      if (i % 2 === 0) {
        a = mid;
      } else {
        b = mid;
      }
    }

    // All indices should be unique and maintain order
    const uniqueIndices = [...new Set(indices)];
    assertEquals(uniqueIndices.length, indices.length);

    const sorted = [...indices].sort();
    assertEquals(validateFractionalIndexOrder(sorted), true);
  });

  await t.step("should handle empty string edge case", () => {
    // Should not throw
    fractionalIndexBetween("", "a");
    fractionalIndexBetween("a", "");
  });

  await t.step("should reject invalid orderings", () => {
    assertThrows(() => fractionalIndexBetween("z", "a"));
    assertThrows(() => fractionalIndexBetween("m", "m"));
  });

  await t.step("should validate fractional indices correctly", () => {
    assertEquals(isValidFractionalIndex("a"), true);
    assertEquals(isValidFractionalIndex("123"), true);
    assertEquals(isValidFractionalIndex("a1b2c3"), true);

    assertEquals(isValidFractionalIndex(""), false);
    assertEquals(isValidFractionalIndex("A"), false); // uppercase not allowed
    assertEquals(isValidFractionalIndex("a-b"), false); // hyphen not allowed
    assertEquals(isValidFractionalIndex("a b"), false); // space not allowed
  });
});

Deno.test("Fractional Indexing - Cell Integration", async (t: Deno.TestContext) => {
  await t.step("should create cells with proper fractional indices", () => {
    // Simulate creating cells with fractional indices
    const cells: Array<{ id: string; fractionalIndex: string }> = [];

    // Create first cell
    const cellId1 = "cell-1";
    const index1 = initialFractionalIndex();
    cells.push({ id: cellId1, fractionalIndex: index1 });

    // Create second cell after first
    const cellId2 = "cell-2";
    const index2 = fractionalIndexBetween(index1, null);
    cells.push({ id: cellId2, fractionalIndex: index2 });

    // Create third cell between first and second
    const cellId3 = "cell-3";
    const index3 = fractionalIndexBetween(index1, index2);
    cells.push({ id: cellId3, fractionalIndex: index3 });

    // Sort cells by fractional index
    cells.sort((a, b) => a.fractionalIndex.localeCompare(b.fractionalIndex));

    // Verify ordering
    assertEquals(cells.length, 3);
    assertEquals(cells[0].id, cellId1);
    assertEquals(cells[1].id, cellId3);
    assertEquals(cells[2].id, cellId2);

    // Verify indices maintain order
    const indices = cells.map((c) => c.fractionalIndex);
    assertEquals(validateFractionalIndexOrder(indices), true);
  });

  await t.step("should move cells correctly using moveCellBetween", () => {
    // Create initial cells
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "a", cellType: "code" },
      { id: "cell-2", fractionalIndex: "m", cellType: "code" },
      { id: "cell-3", fractionalIndex: "t", cellType: "code" },
      { id: "cell-4", fractionalIndex: "z", cellType: "code" },
    ];

    // Move cell-4 between cell-1 and cell-2
    const moveEvent = moveCellBetween(
      cells[3], // cell-4
      cells[0], // cell-1 (before)
      cells[1], // cell-2 (after)
      "user-1",
    );

    assertEquals(moveEvent !== null, true);
    if (moveEvent) {
      // Verify the move event has correct data
      assertEquals(moveEvent.name, "v2.CellMoved");
      assertEquals(moveEvent.args.id, "cell-4");

      const newIndex = moveEvent.args.fractionalIndex;
      assertEquals(newIndex > "a", true);
      assertEquals(newIndex < "m", true);

      // Update the cell with new index
      cells[3].fractionalIndex = newIndex;

      // Sort and verify order
      const sorted = [...cells].sort((a, b) =>
        a.fractionalIndex!.localeCompare(b.fractionalIndex!)
      );

      assertEquals(sorted[0].id, "cell-1");
      assertEquals(sorted[1].id, "cell-4"); // moved here
      assertEquals(sorted[2].id, "cell-2");
      assertEquals(sorted[3].id, "cell-3");
    }
  });

  await t.step("should handle rapid consecutive moves", () => {
    // Create cells
    const cellCount = 5;
    const cells: CellReference[] = [];

    for (let i = 0; i < cellCount; i++) {
      const index = fractionalIndexBetween(
        i > 0 ? cells[i - 1].fractionalIndex : null,
        null,
      );

      cells.push({
        id: `cell-${i}`,
        fractionalIndex: index!,
        cellType: "code",
      });
    }

    // Perform multiple moves rapidly
    // Move last cell up repeatedly
    for (let i = 0; i < 3; i++) {
      // Sort cells by fractional index
      cells.sort((a, b) =>
        a.fractionalIndex!.localeCompare(b.fractionalIndex!)
      );

      const lastIdx = cells.length - 1;
      const targetIdx = lastIdx - 1;

      if (targetIdx < 0) break;

      const moveEvent = moveCellBetween(
        cells[lastIdx],
        targetIdx > 0 ? cells[targetIdx - 1] : null,
        cells[targetIdx],
        "user-1",
      );

      if (moveEvent) {
        // Update the cell's fractional index
        cells[lastIdx].fractionalIndex = moveEvent.args.fractionalIndex;
      }
    }

    // Sort final cells
    cells.sort((a, b) => a.fractionalIndex!.localeCompare(b.fractionalIndex!));

    // Verify final ordering is valid
    const finalIndices = cells.map((c) => c.fractionalIndex).filter((
      idx,
    ): idx is string => idx !== null);
    assertEquals(validateFractionalIndexOrder(finalIndices), true);

    // Verify no duplicates
    const uniqueIndices = [...new Set(finalIndices)];
    assertEquals(uniqueIndices.length, finalIndices.length);
  });

  await t.step("should detect when cell is already in position", () => {
    // Create three cells
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "a", cellType: "code" },
      { id: "cell-2", fractionalIndex: "m", cellType: "code" },
      { id: "cell-3", fractionalIndex: "z", cellType: "code" },
    ];

    // Try to move cell-2 to where it already is (between cell-1 and cell-3)
    const moveEvent = moveCellBetween(
      cells[1], // cell-2
      cells[0], // cell-1
      cells[2], // cell-3
      "user-1",
    );

    // Should return null since cell is already in position
    assertEquals(moveEvent, null);
  });

  await t.step("should create cells between existing cells", () => {
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "a", cellType: "code" },
      { id: "cell-2", fractionalIndex: "z", cellType: "code" },
    ];

    // Create a cell between cell-1 and cell-2
    const createResult = createCellBetween(
      {
        id: "cell-3",
        cellType: "code",
        createdBy: "user-1",
      },
      cells[0],
      cells[1],
      cells,
    );

    const createEvent = createResult.events.find((e) =>
      e.name === "v2.CellCreated"
    )!;
    assertEquals(createEvent.name, "v2.CellCreated");
    assertEquals(createEvent.args.id, "cell-3");
    assertEquals(createEvent.args.fractionalIndex > "a", true);
    assertEquals(createEvent.args.fractionalIndex < "z", true);
  });
});

Deno.test("Fractional Indexing - Stress Tests", async (t: Deno.TestContext) => {
  await t.step("should handle extreme clustering without collision", () => {
    const noJitter = { random: () => 0, randomInt: () => 0 };
    const indices: string[] = [];

    // Start with indices that have reasonable space between them
    indices.push("a");
    indices.push("c");

    // Keep inserting between them
    let _adjacentFound = false;
    for (let i = 0; i < 50; i++) {
      try {
        const idx = fractionalIndexBetween(indices[0], indices[1], noJitter);
        assertEquals(idx > indices[0], true);
        assertEquals(idx < indices[1], true);
        indices.splice(1, 0, idx);
      } catch (e) {
        // Expected when we hit adjacent strings
        if (
          e instanceof Error && e.message.includes("No string exists between")
        ) {
          _adjacentFound = true;
          break;
        }
        throw e;
      }
    }

    // All indices should be unique up to the point we stopped
    const uniqueIndices = [...new Set(indices)];
    assertEquals(uniqueIndices.length, indices.length);
    assertEquals(validateFractionalIndexOrder(indices), true);
  });

  await t.step("should detect truly adjacent strings", () => {
    const noJitter = { random: () => 0, randomInt: () => 0 };

    // These are truly adjacent in our encoding
    assertThrows(
      () => fractionalIndexBetween("a", "a0", noJitter),
      Error,
      "No string exists between",
    );
  });

  await t.step("should handle long index chains", () => {
    const noJitter = { random: () => 0, randomInt: () => 0 };
    let index = "a";

    // Generate a long chain by always inserting after
    for (let i = 0; i < 100; i++) {
      index = fractionalIndexBetween(index, null, noJitter);
      assertEquals(isValidFractionalIndex(index), true);
    }

    // Index should still be reasonable length
    assertEquals(index.length < 20, true);
  });

  await t.step("should handle boundary values correctly", () => {
    // Test with extreme base36 values
    const index1 = fractionalIndexBetween("0", "1");
    assertEquals(index1 > "0", true);
    assertEquals(index1 < "1", true);

    const index2 = fractionalIndexBetween("y", "z");
    assertEquals(index2 > "y", true);
    assertEquals(index2 < "z", true);

    // Test very long strings
    const longA = "a".repeat(50);
    const longB = "b".repeat(50);
    const index3 = fractionalIndexBetween(longA, longB);
    assertEquals(index3 > longA, true);
    assertEquals(index3 < longB, true);
  });
});

Deno.test("Fractional Indexing - generateFractionalIndices", async (t: Deno.TestContext) => {
  await t.step("should generate n indices between boundaries", () => {
    const indices = generateFractionalIndices("a", "z", 10);
    assertEquals(indices.length, 10);

    // All should be between a and z
    for (const idx of indices) {
      assertEquals(idx > "a", true);
      assertEquals(idx < "z", true);
      assertEquals(isValidFractionalIndex(idx), true);
    }

    // Should maintain order
    assertEquals(validateFractionalIndexOrder(["a", ...indices, "z"]), true);
  });

  await t.step("should handle edge cases", () => {
    assertEquals(generateFractionalIndices("a", "z", 0), []);
    assertEquals(generateFractionalIndices("a", "z", 1).length, 1);
    assertEquals(generateFractionalIndices(null, null, 5).length, 5);
  });

  await t.step("should generate well-distributed indices", () => {
    const noJitter = { random: () => 0, randomInt: () => 0 };
    const indices = generateFractionalIndices("a", "z", 5, noJitter);

    // Check that indices are reasonably spaced
    const withBounds = ["a", ...indices, "z"];
    let minGap = Infinity;

    for (let i = 1; i < withBounds.length; i++) {
      const gap = withBounds[i].charCodeAt(0) - withBounds[i - 1].charCodeAt(0);
      if (gap < minGap) minGap = gap;
    }

    // Should have reasonable spacing (not all clustered)
    assertEquals(minGap > 0, true);
  });
});

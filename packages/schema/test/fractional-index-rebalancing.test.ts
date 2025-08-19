/// <reference lib="deno.ns" />

import {
  assertEquals,
  assertExists,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type CellReference,
  createTestJitterProvider,
  fractionalIndexBetween,
  fractionalIndexBetweenWithFallback,
  isValidFractionalIndex,
  moveCellWithRebalancing,
  needsRebalancing,
  rebalanceCellIndices,
  validateFractionalIndexOrder,
} from "../mod.ts";

/**
 * Comprehensive tests for fractional index rebalancing functionality
 * These tests ensure the UI never gets "stuck" due to adjacent indices
 */

Deno.test("Fractional Index Rebalancing - needsRebalancing Detection", async (t) => {
  await t.step("should detect when cells have adjacent indices", () => {
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "m", cellType: "code" },
      { id: "cell-2", fractionalIndex: "m0", cellType: "code" },
      { id: "cell-3", fractionalIndex: "n", cellType: "code" },
    ];

    assertEquals(needsRebalancing(cells), true);
  });

  await t.step(
    "should not detect rebalancing need for well-spaced indices",
    () => {
      const cells: CellReference[] = [
        { id: "cell-1", fractionalIndex: "a", cellType: "code" },
        { id: "cell-2", fractionalIndex: "m", cellType: "code" },
        { id: "cell-3", fractionalIndex: "z", cellType: "code" },
      ];

      assertEquals(needsRebalancing(cells), false);
    },
  );

  await t.step("should handle empty and single cell arrays", () => {
    assertEquals(needsRebalancing([]), false);
    assertEquals(
      needsRebalancing([
        { id: "cell-1", fractionalIndex: "m", cellType: "code" },
      ]),
      false,
    );
  });

  await t.step("should detect insertion position conflicts", () => {
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "a", cellType: "code" },
      { id: "cell-2", fractionalIndex: "a0", cellType: "code" },
      { id: "cell-3", fractionalIndex: "b", cellType: "code" },
    ];

    // Trying to insert between cell-1 and cell-2 should trigger rebalancing
    assertEquals(needsRebalancing(cells, 1), true);
  });

  await t.step("should handle cells with missing fractional indices", () => {
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "a", cellType: "code" },
      { id: "cell-2", fractionalIndex: null, cellType: "code" },
      { id: "cell-3", fractionalIndex: "b", cellType: "code" },
    ];

    // Should not crash and should handle gracefully
    assertEquals(needsRebalancing(cells), false);
  });
});

Deno.test("Fractional Index Rebalancing - rebalanceCellIndices", async (t) => {
  await t.step("should rebalance adjacent indices with proper spacing", () => {
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "m", cellType: "code" },
      { id: "cell-2", fractionalIndex: "m0", cellType: "code" },
      { id: "cell-3", fractionalIndex: "m00", cellType: "code" },
    ];

    const jitter = createTestJitterProvider(42);
    const result = rebalanceCellIndices(cells, {
      jitterProvider: jitter,
      actorId: "test-user",
      bufferCells: 1,
    });

    // Should generate new indices for all cells
    assertEquals(result.newIndices.length, 3);
    assertEquals(result.events.length, 3);

    // Extract just the new indices for validation
    const newIndices = result.newIndices.map((ni) => ni.fractionalIndex);

    // All should be valid fractional indices
    newIndices.forEach((idx) => {
      assertEquals(isValidFractionalIndex(idx), true);
    });

    // Should maintain proper ordering
    assertEquals(validateFractionalIndexOrder(newIndices), true);

    // Should be able to insert between any adjacent pair
    for (let i = 0; i < newIndices.length - 1; i++) {
      const between = fractionalIndexBetween(newIndices[i], newIndices[i + 1]);
      assertEquals(between > newIndices[i], true);
      assertEquals(between < newIndices[i + 1], true);
    }
  });

  await t.step("should preserve cell order during rebalancing", () => {
    const cells: CellReference[] = [
      { id: "first", fractionalIndex: "a", cellType: "code" },
      { id: "second", fractionalIndex: "a0", cellType: "code" },
      { id: "third", fractionalIndex: "b", cellType: "code" },
    ];

    const result = rebalanceCellIndices(cells);

    // Sort results by new fractional index
    const sortedResults = result.newIndices.sort((a, b) =>
      a.fractionalIndex.localeCompare(b.fractionalIndex)
    );

    // Should maintain original order
    assertEquals(sortedResults[0].cellId, "first");
    assertEquals(sortedResults[1].cellId, "second");
    assertEquals(sortedResults[2].cellId, "third");
  });

  await t.step("should generate proper move events", () => {
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "m", cellType: "code" },
      { id: "cell-2", fractionalIndex: "m0", cellType: "code" },
    ];

    const result = rebalanceCellIndices(cells, {
      actorId: "test-user",
    });

    assertEquals(result.events.length, 2);

    result.events.forEach((event) => {
      assertEquals(event.name, "v2.CellMoved");
      assertEquals(event.args.actorId, "test-user");
      assertExists(event.args.id);
      assertExists(event.args.fractionalIndex);
    });
  });

  await t.step("should handle empty cell array", () => {
    const result = rebalanceCellIndices([]);
    assertEquals(result.newIndices.length, 0);
    assertEquals(result.events.length, 0);
  });

  await t.step("should respect buffer cells parameter", () => {
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "m", cellType: "code" },
      { id: "cell-2", fractionalIndex: "m0", cellType: "code" },
    ];

    const jitter = createTestJitterProvider(123);

    // Generate indices with different buffer sizes
    const result1 = rebalanceCellIndices(cells, {
      jitterProvider: jitter,
      bufferCells: 1,
    });

    const jitter2 = createTestJitterProvider(123);
    const result2 = rebalanceCellIndices(cells, {
      jitterProvider: jitter2,
      bufferCells: 3,
    });

    // Both should have space for insertions, but different distributions
    const indices1 = result1.newIndices.map((ni) => ni.fractionalIndex);
    const indices2 = result2.newIndices.map((ni) => ni.fractionalIndex);

    // Should be able to insert before, between, and after in both cases
    for (const indices of [indices1, indices2]) {
      // Insert before first
      const beforeFirst = fractionalIndexBetween(null, indices[0]);
      assertEquals(beforeFirst < indices[0], true);

      // Insert between
      if (indices.length > 1) {
        const between = fractionalIndexBetween(indices[0], indices[1]);
        assertEquals(between > indices[0] && between < indices[1], true);
      }

      // Insert after last
      const afterLast = fractionalIndexBetween(
        indices[indices.length - 1],
        null,
      );
      assertEquals(afterLast > indices[indices.length - 1], true);
    }
  });
});

Deno.test("Fractional Index Rebalancing - fractionalIndexBetweenWithFallback", async (t) => {
  await t.step("should return normal index when no rebalancing needed", () => {
    const result = fractionalIndexBetweenWithFallback("a", "z");

    assertEquals(result.needsRebalancing, false);
    assertExists(result.index);
    assertEquals(result.index! > "a", true);
    assertEquals(result.index! < "z", true);
    assertEquals(result.rebalanceResult, undefined);
  });

  await t.step("should trigger rebalancing for adjacent strings", () => {
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "m", cellType: "code" },
      { id: "cell-2", fractionalIndex: "m0", cellType: "code" },
      { id: "cell-3", fractionalIndex: "n", cellType: "code" },
    ];

    const result = fractionalIndexBetweenWithFallback("m", "m0", {
      allCells: cells,
      insertPosition: 1,
    });

    assertEquals(result.needsRebalancing, true);
    assertEquals(typeof result.index, "string");
    assertExists(result.rebalanceResult);

    // Rebalancing should provide new indices for all cells
    assertEquals(result.rebalanceResult.newIndices.length, 3);
    assertEquals(result.rebalanceResult.events.length, 3);
  });

  await t.step("should handle case with no context cells", () => {
    // Without context cells, should just throw the original error
    assertThrows(
      () => fractionalIndexBetweenWithFallback("m", "m0"),
      Error,
      "No string exists between",
    );
  });

  await t.step("should maintain deterministic behavior with jitter", () => {
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "a", cellType: "code" },
      { id: "cell-2", fractionalIndex: "a0", cellType: "code" },
    ];

    const jitter = createTestJitterProvider(777);

    const result1 = fractionalIndexBetweenWithFallback("a", "a0", {
      allCells: cells,
      jitterProvider: jitter,
    });

    const jitter2 = createTestJitterProvider(777);
    const result2 = fractionalIndexBetweenWithFallback("a", "a0", {
      allCells: cells,
      jitterProvider: jitter2,
    });

    // Both should need rebalancing
    assertEquals(result1.needsRebalancing, true);
    assertEquals(result2.needsRebalancing, true);

    // Results should be identical with same seed
    assertEquals(
      result1.rebalanceResult?.newIndices,
      result2.rebalanceResult?.newIndices,
    );
  });
});

Deno.test("Fractional Index Rebalancing - moveCellWithRebalancing", async (t) => {
  await t.step("should perform normal move when possible", () => {
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "a", cellType: "code" },
      { id: "cell-2", fractionalIndex: "m", cellType: "code" },
      { id: "cell-3", fractionalIndex: "z", cellType: "code" },
    ];

    const result = moveCellWithRebalancing(
      cells[1], // Move cell-2
      null, // to beginning
      cells[0], // before cell-1
      cells,
    );

    assertEquals(result.needsRebalancing, false);
    assertExists(result.moveEvent);
    assertEquals(result.moveEvent.args.id, "cell-2");
    assertEquals(result.rebalanceResult, undefined);
  });

  await t.step("should trigger rebalancing when normal move fails", () => {
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "m", cellType: "code" },
      { id: "cell-2", fractionalIndex: "m0", cellType: "code" },
      { id: "cell-3", fractionalIndex: "m00", cellType: "code" },
    ];

    const result = moveCellWithRebalancing(
      cells[2], // Move cell-3
      cells[0], // between cell-1
      cells[1], // and cell-2
      cells,
      { actorId: "test-user" },
    );

    assertEquals(result.needsRebalancing, true);
    assertEquals(result.moveEvent, undefined);
    assertExists(result.rebalanceResult);

    // Should generate rebalancing events
    assertEquals(result.rebalanceResult.events.length > 0, true);
    result.rebalanceResult.events.forEach((event) => {
      assertEquals(event.args.actorId, "test-user-rebalance");
    });
  });

  await t.step("should handle no-op moves correctly", () => {
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "a", cellType: "code" },
      { id: "cell-2", fractionalIndex: "m", cellType: "code" },
      { id: "cell-3", fractionalIndex: "z", cellType: "code" },
    ];

    // Try to move cell-2 to where it already is
    const result = moveCellWithRebalancing(
      cells[1], // cell-2
      cells[0], // after cell-1
      cells[2], // before cell-3 (where it already is)
      cells,
    );

    assertEquals(result.needsRebalancing, false);
    assertEquals(result.moveEvent, undefined);
    assertEquals(result.rebalanceResult, undefined);
  });

  await t.step("should use custom actor ID and jitter", () => {
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "m", cellType: "code" },
      { id: "cell-2", fractionalIndex: "m0", cellType: "code" },
    ];

    const jitter = createTestJitterProvider(999);

    const result = moveCellWithRebalancing(
      cells[1],
      null,
      cells[0],
      cells,
      {
        actorId: "custom-user",
        jitterProvider: jitter,
      },
    );

    if (result.rebalanceResult) {
      result.rebalanceResult.events.forEach((event) => {
        assertEquals(event.args.actorId, "custom-user-rebalance");
      });
    }
  });
});

Deno.test("Fractional Index Rebalancing - Real-world Scenarios", async (t) => {
  await t.step("should handle deeply nested adjacent indices", () => {
    // Simulate what happens when users rapidly insert cells in same location
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "m", cellType: "code" },
      { id: "cell-2", fractionalIndex: "m0", cellType: "code" },
      { id: "cell-3", fractionalIndex: "m00", cellType: "code" },
      { id: "cell-4", fractionalIndex: "m000", cellType: "code" },
      { id: "cell-5", fractionalIndex: "m0000", cellType: "code" },
    ];

    const result = rebalanceCellIndices(cells, { bufferCells: 2 });

    assertEquals(result.newIndices.length, 5);

    const newIndices = result.newIndices.map((ni) => ni.fractionalIndex);

    // Should be able to insert between any adjacent pair after rebalancing
    for (let i = 0; i < newIndices.length - 1; i++) {
      const between = fractionalIndexBetween(newIndices[i], newIndices[i + 1]);
      assertEquals(isValidFractionalIndex(between), true);
      assertEquals(between > newIndices[i], true);
      assertEquals(between < newIndices[i + 1], true);
    }

    // Should be able to insert at beginning and end
    const beforeFirst = fractionalIndexBetween(null, newIndices[0]);
    const afterLast = fractionalIndexBetween(
      newIndices[newIndices.length - 1],
      null,
    );

    assertEquals(isValidFractionalIndex(beforeFirst), true);
    assertEquals(isValidFractionalIndex(afterLast), true);
  });

  await t.step("should handle mixed spacing scenarios", () => {
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "a", cellType: "code" }, // Well spaced
      { id: "cell-2", fractionalIndex: "b", cellType: "code" }, // Well spaced
      { id: "cell-3", fractionalIndex: "m", cellType: "code" }, // Start of crowded section
      { id: "cell-4", fractionalIndex: "m0", cellType: "code" }, // Crowded
      { id: "cell-5", fractionalIndex: "m00", cellType: "code" }, // Crowded
      { id: "cell-6", fractionalIndex: "z", cellType: "code" }, // Well spaced again
    ];

    assertEquals(needsRebalancing(cells), true);

    const result = rebalanceCellIndices(cells);
    const newIndices = result.newIndices.map((ni) => ni.fractionalIndex);

    // After rebalancing, should be able to insert anywhere
    for (let i = 0; i <= newIndices.length; i++) {
      const before = i > 0 ? newIndices[i - 1] : null;
      const after = i < newIndices.length ? newIndices[i] : null;

      try {
        const between = fractionalIndexBetween(before, after);
        assertEquals(isValidFractionalIndex(between), true);
      } catch (error) {
        throw new Error(
          `Failed to insert at position ${i} between "${before}" and "${after}": ${error}`,
        );
      }
    }
  });

  await t.step("should handle large numbers of cells efficiently", () => {
    // Create 20 cells with problematic adjacent indices
    const cells: CellReference[] = [];
    const base = "m";

    for (let i = 0; i < 20; i++) {
      cells.push({
        id: `cell-${i}`,
        fractionalIndex: base + "0".repeat(i),
        cellType: "code",
      });
    }

    assertEquals(needsRebalancing(cells), true);

    const result = rebalanceCellIndices(cells, { bufferCells: 5 });

    assertEquals(result.newIndices.length, 20);
    assertEquals(result.events.length, 20);

    const newIndices = result.newIndices.map((ni) => ni.fractionalIndex);

    // Should maintain order
    assertEquals(validateFractionalIndexOrder(newIndices), true);

    // All indices should be valid
    newIndices.forEach((idx) => {
      assertEquals(isValidFractionalIndex(idx), true);
    });

    // Should have adequate spacing for future insertions
    for (let i = 0; i < newIndices.length - 1; i++) {
      const between = fractionalIndexBetween(newIndices[i], newIndices[i + 1]);
      assertEquals(isValidFractionalIndex(between), true);
    }
  });

  await t.step(
    "should preserve performance with reasonable index lengths",
    () => {
      const cells: CellReference[] = Array.from({ length: 50 }, (_, i) => ({
        id: `cell-${i}`,
        fractionalIndex: "m" + "0".repeat(i),
        cellType: "code" as const,
      }));

      const result = rebalanceCellIndices(cells);
      const newIndices = result.newIndices.map((ni) => ni.fractionalIndex);

      // Indices should be reasonably short (not growing exponentially)
      const maxLength = Math.max(...newIndices.map((idx) => idx.length));
      assertEquals(
        maxLength < 50,
        true,
        `Max index length too long: ${maxLength}`,
      );

      // All should still be valid
      newIndices.forEach((idx) => {
        assertEquals(isValidFractionalIndex(idx), true);
      });
    },
  );
});

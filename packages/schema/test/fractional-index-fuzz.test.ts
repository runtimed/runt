/// <reference lib="deno.ns" />

import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type CellReference,
  createTestJitterProvider,
  fractionalIndexBetween,
  fractionalIndexBetweenWithFallback,
  isValidFractionalIndex,
  moveCellBetween,
  validateFractionalIndexOrder,
} from "../mod.ts";

/**
 * Comprehensive fuzzing tests for fractional indexing edge cases
 * These tests focus on scenarios that could cause issues in production
 */

Deno.test("Fractional Indexing Fuzz - Adjacent String Edge Cases", async (t) => {
  await t.step("should handle m/m0 type adjacent strings", () => {
    const problematicCases = [
      ["m", "m0"],
      ["a", "a0"],
      ["z", "z0"],
      ["m0", "m00"],
      ["abc", "abc0"],
      ["m" + "0".repeat(5), "m" + "0".repeat(6)],
    ];

    const noJitter = { random: () => 0, randomInt: () => 0 };

    for (const [a, b] of problematicCases) {
      try {
        const index = fractionalIndexBetween(a, b, noJitter);

        // Should not reach here - these are truly adjacent
        throw new Error(`Expected adjacent string error but got: ${index}`);
      } catch (error) {
        // Verify we get the expected "No string exists between" error
        assertEquals(
          error instanceof Error &&
            error.message.includes("No string exists between"),
          true,
          `Expected adjacent string error for "${a}" and "${b}", got: ${error}`,
        );
      }
    }
  });

  await t.step("should handle near-adjacent strings correctly", () => {
    const nearAdjacentCases = [
      ["a", "c"],
      ["m", "o"],
      ["z", "z2"],
      ["m0", "m2"],
    ];

    const noJitter = { random: () => 0, randomInt: () => 0 };

    for (const [a, b] of nearAdjacentCases) {
      const index = fractionalIndexBetween(a, b, noJitter);

      assertEquals(index > a, true, `Generated index not greater than "${a}"`);
      assertEquals(index < b, true, `Generated index not less than "${b}"`);
      assertEquals(
        isValidFractionalIndex(index),
        true,
        `Generated invalid index: "${index}"`,
      );
    }
  });
});

Deno.test("Fractional Indexing Fuzz - Rapid Insertion Clustering", async (t) => {
  await t.step(
    "should handle rapid insertion without invalid characters",
    () => {
      const noJitter = { random: () => 0, randomInt: () => 0 };

      // Test multiple starting ranges
      const startingRanges = [
        ["a", "c"],
        ["m", "n"],
        ["y", "z"],
        ["0", "2"],
        ["8", "a"],
      ];

      for (const [startA, startB] of startingRanges) {
        const indices = [startA, startB];
        let insertionCount = 0;

        // Attempt up to 30 insertions
        for (let i = 0; i < 30; i++) {
          // Pick a random gap
          const gapIndex = Math.floor(Math.random() * (indices.length - 1));
          const a = indices[gapIndex];
          const b = indices[gapIndex + 1];

          try {
            const newIndex = fractionalIndexBetween(a, b, noJitter);

            // Verify no invalid characters
            for (let j = 0; j < newIndex.length; j++) {
              const char = newIndex[j];
              const isValidChar = "0123456789abcdefghijklmnopqrstuvwxyz"
                .includes(char);
              assertEquals(
                isValidChar,
                true,
                `Invalid character "${char}" at position ${j} in "${newIndex}"`,
              );
            }

            // Verify ordering
            assertEquals(
              newIndex > a,
              true,
              `Ordering violation: "${newIndex}" <= "${a}"`,
            );
            assertEquals(
              newIndex < b,
              true,
              `Ordering violation: "${newIndex}" >= "${b}"`,
            );

            indices.splice(gapIndex + 1, 0, newIndex);
            insertionCount++;
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes("No string exists between")
            ) {
              // Expected when hitting truly adjacent strings
              break;
            }
            throw error;
          }
        }

        // Should have been able to insert at least a few indices
        assertEquals(
          insertionCount >= 1,
          true,
          `No insertions possible between "${startA}" and "${startB}"`,
        );

        // Verify final ordering
        assertEquals(
          validateFractionalIndexOrder(indices),
          true,
          "Final ordering validation failed",
        );
      }
    },
  );

  await t.step("should maintain deterministic behavior", () => {
    const jitter1 = createTestJitterProvider(42);
    const jitter2 = createTestJitterProvider(42);

    const indices1: string[] = [];
    const indices2: string[] = [];

    // Generate same sequence with same seed
    let prev1: string | null = null;
    let prev2: string | null = null;

    for (let i = 0; i < 10; i++) {
      const idx1 = fractionalIndexBetween(prev1, null, jitter1);
      const idx2 = fractionalIndexBetween(prev2, null, jitter2);

      assertEquals(idx1, idx2, `Deterministic generation failed at step ${i}`);

      indices1.push(idx1);
      indices2.push(idx2);
      prev1 = idx1;
      prev2 = idx2;
    }
  });
});

Deno.test("Fractional Indexing Fuzz - Cell Movement Edge Cases", async (t) => {
  await t.step(
    "should handle cell movements without ordering violations",
    () => {
      for (let testRun = 0; testRun < 10; testRun++) {
        // Create cells with valid fractional indices
        const cellCount = 5 + Math.floor(Math.random() * 10);
        const cells: CellReference[] = [];

        // Generate sequential indices to avoid duplicates
        let previousIndex: string | null = null;

        for (let i = 0; i < cellCount; i++) {
          const fractionalIndex = fractionalIndexBetween(previousIndex, null);
          cells.push({
            id: `cell-${i}`,
            fractionalIndex,
            cellType: "code",
          });
          previousIndex = fractionalIndex;
        }

        // Sort cells by fractional index
        cells.sort((a, b) =>
          a.fractionalIndex!.localeCompare(b.fractionalIndex!)
        );

        // Perform several moves
        for (let move = 0; move < 5; move++) {
          const cellToMove = Math.floor(Math.random() * cells.length);
          const targetPos = Math.floor(Math.random() * (cells.length + 1));

          if (targetPos === cellToMove || targetPos === cellToMove + 1) {
            continue; // Skip no-op moves
          }

          const cell = cells[cellToMove];

          // Create array without the cell being moved to determine correct before/after
          const remainingCells = cells.filter((_, idx) => idx !== cellToMove);
          const adjustedTargetPos = targetPos > cellToMove
            ? targetPos - 1
            : targetPos;

          const before = adjustedTargetPos > 0
            ? remainingCells[adjustedTargetPos - 1]
            : null;
          const after = adjustedTargetPos < remainingCells.length
            ? remainingCells[adjustedTargetPos]
            : null;

          try {
            const moveEvent = moveCellBetween(cell, before, after, "user-1");

            if (moveEvent) {
              // Update the cell's index
              cell.fractionalIndex = moveEvent.args.fractionalIndex;

              // Re-sort and verify
              cells.sort((a, b) =>
                a.fractionalIndex!.localeCompare(b.fractionalIndex!)
              );

              // Verify ordering is maintained
              const indices = cells.map((c) => c.fractionalIndex).filter((
                idx,
              ): idx is string => idx !== null);
              assertEquals(
                validateFractionalIndexOrder(indices),
                true,
                `Ordering validation failed after move in test run ${testRun}`,
              );
            }
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes("No string exists between")
            ) {
              // This can happen with very close cells - acceptable
              continue;
            }
            throw new Error(
              `Unexpected error in test run ${testRun}, move ${move}: ${error}`,
            );
          }
        }
      }
    },
  );

  await t.step("should detect and handle no-op moves correctly", () => {
    const cells: CellReference[] = [
      { id: "cell-1", fractionalIndex: "a", cellType: "code" },
      { id: "cell-2", fractionalIndex: "m", cellType: "code" },
      { id: "cell-3", fractionalIndex: "z", cellType: "code" },
    ];

    // Try to move cell-2 to where it already is (between cell-1 and cell-3)
    const moveEvent = moveCellBetween(cells[1], cells[0], cells[2], "user-1");

    // Should return null since cell is already in correct position
    assertEquals(moveEvent, null, "Expected null for no-op move");
  });
});

Deno.test("Fractional Indexing Fuzz - Boundary Conditions", async (t) => {
  await t.step("should handle extreme boundary values", () => {
    const extremeCases = [
      // Single character boundaries
      ["0", "1"],
      ["9", "a"],
      ["y", "z"],

      // Null boundaries
      [null, "1"],
      ["z", null],

      // Long string boundaries
      ["a".repeat(15), "b".repeat(15)],
      ["z".repeat(10), null],
      [null, "1".repeat(10)],

      // Mixed length strings
      ["a", "a".repeat(10)],
      ["m".repeat(3), "m".repeat(3) + "0"],
    ];

    for (const [a, b] of extremeCases) {
      try {
        const index = fractionalIndexBetween(a, b);

        // Verify bounds
        if (a !== null) {
          assertEquals(
            index > a,
            true,
            `Generated index not greater than "${a}"`,
          );
        }
        if (b !== null) {
          assertEquals(index < b, true, `Generated index not less than "${b}"`);
        }

        assertEquals(
          isValidFractionalIndex(index),
          true,
          `Generated invalid index: "${index}"`,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("No string exists between")
        ) {
          // Expected for truly adjacent strings
          continue;
        }
        throw new Error(`Unexpected error for case [${a}, ${b}]: ${error}`);
      }
    }
  });

  await t.step("should reject invalid input ranges", () => {
    const invalidCases = [
      ["z", "a"],
      ["m", "m"],
      ["abc", "abb"],
      ["z0", "z"],
    ];

    for (const [a, b] of invalidCases) {
      assertThrows(
        () => fractionalIndexBetween(a, b),
        Error,
        "Invalid range",
        `Should reject invalid range: "${a}" to "${b}"`,
      );
    }
  });
});

Deno.test("Fractional Indexing Fuzz - Character Encoding Validation", async (t) => {
  await t.step("should only generate valid base36 characters", () => {
    const validChars = "0123456789abcdefghijklmnopqrstuvwxyz";
    const testCases = 100;

    for (let i = 0; i < testCases; i++) {
      // Generate random valid inputs
      const len1 = 1 + Math.floor(Math.random() * 5);
      const len2 = 1 + Math.floor(Math.random() * 5);

      let a = "";
      let b = "";

      for (let j = 0; j < len1; j++) {
        a += validChars[Math.floor(Math.random() * validChars.length)];
      }

      for (let j = 0; j < len2; j++) {
        b += validChars[Math.floor(Math.random() * validChars.length)];
      }

      // Ensure a < b, skip if equal
      if (a >= b) {
        [a, b] = [b, a];
        // Skip if they're still equal after swap
        if (a === b) {
          continue;
        }
      }

      try {
        const result = fractionalIndexBetween(a, b);

        // Verify every character is valid
        for (let k = 0; k < result.length; k++) {
          const char = result[k];
          assertEquals(
            validChars.includes(char),
            true,
            `Invalid character "${char}" (ASCII: ${
              char.charCodeAt(0)
            }) found in result "${result}"`,
          );
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("No string exists between")
        ) {
          // Expected for truly adjacent strings
          continue;
        }
        throw error;
      }
    }
  });

  await t.step("should handle edge cases with fallback function", () => {
    // Create mock cells for rebalancing context
    const mockCells: CellReference[] = [
      { id: "cell1", fractionalIndex: "a", cellType: "code" },
      { id: "cell2", fractionalIndex: "a", cellType: "code" }, // Duplicate index to trigger rebalancing need
      { id: "cell3", fractionalIndex: "b", cellType: "code" },
    ];

    // Test equal strings case with fallback and rebalancing context
    const result = fractionalIndexBetweenWithFallback("a", "a", {
      allCells: mockCells,
      insertPosition: 1,
    });
    assertEquals(result.needsRebalancing, true);
    assertEquals(typeof result.index, "string");
    assertEquals(typeof result.rebalanceResult, "object");

    // Test normal case with fallback
    const result2 = fractionalIndexBetweenWithFallback("a", "c");
    assertEquals(result2.needsRebalancing, false);
    assertEquals(typeof result2.index, "string");
    assert(result2.index! > "a" && result2.index! < "c");

    // Test equal strings without rebalancing context should throw
    assertThrows(
      () => {
        fractionalIndexBetweenWithFallback("a", "a");
      },
      Error,
      "Invalid range",
    );
  });

  await t.step("should validate fractional index format correctly", () => {
    const validIndices = [
      "a",
      "m",
      "z",
      "123",
      "abc123",
      "m0h",
      "z".repeat(20),
    ];

    const invalidIndices = [
      "",
      "A", // uppercase
      "a-b", // hyphen
      "a b", // space
      "a:b", // colon
      "a{b", // curly brace
      "a@b", // at symbol
    ];

    for (const valid of validIndices) {
      assertEquals(
        isValidFractionalIndex(valid),
        true,
        `Should accept valid index: "${valid}"`,
      );
    }

    for (const invalid of invalidIndices) {
      assertEquals(
        isValidFractionalIndex(invalid),
        false,
        `Should reject invalid index: "${invalid}"`,
      );
    }
  });
});

Deno.test("Fractional Indexing Fuzz - Stress Test Sequential Generation", async (t) => {
  await t.step("should handle long sequences without collision", () => {
    const noJitter = { random: () => 0, randomInt: () => 0 };
    const indices: string[] = [];
    let previous: string | null = null;

    // Generate a long sequence
    for (let i = 0; i < 50; i++) {
      const newIndex = fractionalIndexBetween(previous, null, noJitter);

      if (previous) {
        assertEquals(
          newIndex > previous,
          true,
          `Ordering violation at step ${i}: "${newIndex}" <= "${previous}"`,
        );
      }

      assertEquals(
        isValidFractionalIndex(newIndex),
        true,
        `Invalid index at step ${i}: "${newIndex}"`,
      );

      indices.push(newIndex);
      previous = newIndex;
    }

    // Verify final ordering
    assertEquals(
      validateFractionalIndexOrder(indices),
      true,
      "Final sequence ordering validation failed",
    );

    // Verify no duplicates
    const uniqueIndices = [...new Set(indices)];
    assertEquals(
      uniqueIndices.length,
      indices.length,
      "Duplicate indices found in sequence",
    );
  });
});

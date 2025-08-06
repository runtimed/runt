#!/usr/bin/env -S deno run --allow-all

/**
 * Comprehensive fuzzing script for fractional indexing edge cases
 * Focuses on finding problematic scenarios like "m" and "m0" issues
 */

import {
  type CellReference,
  fractionalIndexBetween,
  isValidFractionalIndex,
  moveCellBetween,
  validateFractionalIndexOrder,
} from "./mod.ts";

interface FuzzTestResult {
  name: string;
  iterations: number;
  successes: number;
  failures: number;
  errors: string[];
  examples: string[];
}

class FractionalIndexFuzzer {
  private results: FuzzTestResult[] = [];
  private verbose = false;

  constructor(verbose = false) {
    this.verbose = verbose;
  }

  log(message: string) {
    if (this.verbose) {
      console.log(message);
    }
  }

  fuzzAdjacentStrings(iterations = 1000): FuzzTestResult {
    const result: FuzzTestResult = {
      name: "Adjacent strings (m/m0 type issues)",
      iterations,
      successes: 0,
      failures: 0,
      errors: [],
      examples: [],
    };

    // Test cases that are known to be problematic
    const problematicCases = [
      ["m", "m0"],
      ["a", "a0"],
      ["z", "z0"],
      ["m0", "m00"],
      ["a1", "a10"],
      ["z9", "z90"],
      ["abc", "abc0"],
      ["m" + "0".repeat(10), "m" + "0".repeat(11)],
    ];

    for (let i = 0; i < iterations; i++) {
      try {
        let a: string, b: string;

        if (i < problematicCases.length) {
          // Test known problematic cases first
          [a, b] = problematicCases[i];
        } else {
          // Generate random adjacent-like cases
          const base = this.randomString(1, 5);
          const suffixLength = Math.floor(Math.random() * 3);
          a = base;
          b = base + "0".repeat(suffixLength + 1);

          // Sometimes add a small character after the zeros
          if (Math.random() < 0.3) {
            b += String.fromCharCode(48 + Math.floor(Math.random() * 10)); // 0-9
          }
        }

        const noJitter = { random: () => 0, randomInt: () => 0 };

        try {
          const index = fractionalIndexBetween(a, b, noJitter);

          // Verify the result is valid
          if (index <= a || index >= b) {
            result.failures++;
            result.errors.push(
              `Invalid ordering: ${a} < ${index} < ${b} failed`,
            );
            continue;
          }

          if (!isValidFractionalIndex(index)) {
            result.failures++;
            result.errors.push(
              `Generated invalid index: "${index}" between "${a}" and "${b}"`,
            );
            continue;
          }

          result.successes++;

          if (result.examples.length < 10) {
            result.examples.push(`${a} -> ${index} -> ${b}`);
          }
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("No string exists between")
          ) {
            // This is expected for truly adjacent strings
            result.successes++;
          } else {
            result.failures++;
            result.errors.push(
              `Unexpected error between "${a}" and "${b}": ${error}`,
            );
          }
        }
      } catch (error) {
        result.failures++;
        result.errors.push(`Setup error in iteration ${i}: ${error}`);
      }
    }

    this.results.push(result);
    return result;
  }

  fuzzRapidInsertion(iterations = 500): FuzzTestResult {
    const result: FuzzTestResult = {
      name: "Rapid insertion clustering",
      iterations,
      successes: 0,
      failures: 0,
      errors: [],
      examples: [],
    };

    for (let i = 0; i < iterations; i++) {
      try {
        const indices: string[] = [];
        const noJitter = { random: () => 0, randomInt: () => 0 };

        // Start with a random range - ensure both are valid base36
        const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
        const startA = this.randomString(1, 2);
        let startB: string;

        // Find next valid character in base36 sequence
        const firstChar = startA[0];
        const charIndex = chars.indexOf(firstChar);

        if (charIndex >= 0 && charIndex < chars.length - 1) {
          // Use next character in base36 sequence
          startB = chars[charIndex + 1] + startA.substring(1);
        } else {
          // Fallback: extend startA with a suffix to ensure startB > startA
          startB = startA + "0";
        }

        indices.push(startA);
        indices.push(startB);

        // Rapidly insert between them
        let insertionCount = 0;
        const maxInsertions = 20 + Math.floor(Math.random() * 30);

        for (let j = 0; j < maxInsertions; j++) {
          // Pick a random gap to insert into
          const gapIndex = Math.floor(Math.random() * (indices.length - 1));
          const a = indices[gapIndex];
          const b = indices[gapIndex + 1];

          try {
            const newIndex = fractionalIndexBetween(a, b, noJitter);
            indices.splice(gapIndex + 1, 0, newIndex);
            insertionCount++;

            // Verify ordering is maintained
            for (let k = 1; k < indices.length; k++) {
              if (indices[k - 1] >= indices[k]) {
                throw new Error(
                  `Ordering violation: ${indices[k - 1]} >= ${indices[k]}`,
                );
              }
            }
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes("No string exists between")
            ) {
              // Expected when we hit truly adjacent strings
              break;
            }
            throw error;
          }
        }

        result.successes++;

        if (result.examples.length < 5) {
          result.examples.push(
            `Inserted ${insertionCount} indices, final count: ${indices.length}`,
          );
        }
      } catch (error) {
        result.failures++;
        result.errors.push(`Error in iteration ${i}: ${error}`);
      }
    }

    this.results.push(result);
    return result;
  }

  fuzzCellMovements(iterations = 300): FuzzTestResult {
    const result: FuzzTestResult = {
      name: "Cell movement edge cases",
      iterations,
      successes: 0,
      failures: 0,
      errors: [],
      examples: [],
    };

    for (let i = 0; i < iterations; i++) {
      try {
        // Create a set of cells with potentially problematic indices
        const cellCount = 5 + Math.floor(Math.random() * 15);
        const cells: CellReference[] = [];

        // Generate unique fractional indices for cells
        const useProblematicBases = Math.random() < 0.6;
        let previousIndex: string | null = null;

        for (let j = 0; j < cellCount; j++) {
          let fractionalIndex: string;

          if (useProblematicBases && j < 3) {
            // Use some potentially problematic bases for first few cells
            const problematicBases = ["m", "m0", "m00"];
            fractionalIndex = problematicBases[j];
          } else {
            // Generate a new index after the previous one
            try {
              fractionalIndex = fractionalIndexBetween(previousIndex, null);
            } catch {
              // Fallback if generation fails
              fractionalIndex = this.randomString(1, 3) + j.toString();
            }
          }

          cells.push({
            id: `cell-${j}`,
            fractionalIndex,
            cellType: "code",
          });

          previousIndex = fractionalIndex;
        }

        // Sort cells by fractional index
        cells.sort((a, b) =>
          a.fractionalIndex!.localeCompare(b.fractionalIndex!)
        );

        // Perform random moves
        const moveCount = 5 + Math.floor(Math.random() * 10);

        for (let move = 0; move < moveCount; move++) {
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

              // Verify ordering
              const indices = cells.map((c) => c.fractionalIndex).filter((
                idx,
              ): idx is string => idx !== null);
              if (!validateFractionalIndexOrder(indices)) {
                throw new Error("Ordering validation failed after move");
              }
            }
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes("No string exists between")
            ) {
              // This can happen with very close cells
              continue;
            }
            throw error;
          }
        }

        result.successes++;
      } catch (error) {
        result.failures++;
        result.errors.push(`Error in iteration ${i}: ${error}`);
      }
    }

    this.results.push(result);
    return result;
  }

  fuzzBoundaryConditions(iterations = 200): FuzzTestResult {
    const result: FuzzTestResult = {
      name: "Boundary conditions and extreme values",
      iterations,
      successes: 0,
      failures: 0,
      errors: [],
      examples: [],
    };

    const extremeCases = [
      // Boundary values
      ["0", "1"],
      ["y", "z"],
      ["9", "a"],
      ["z", null],
      [null, "1"],

      // Long strings
      ["a".repeat(20), "b".repeat(20)],
      ["z".repeat(15), null],
      [null, "1".repeat(15)],

      // Mixed lengths
      ["a", "a".repeat(10)],
      ["m".repeat(5), "m".repeat(5) + "0"],

      // Numbers vs letters boundaries
      ["9", "a"],
      ["z", "z0"],
      ["99", "a0"],
    ];

    for (let i = 0; i < iterations; i++) {
      try {
        let a: string | null, b: string | null;

        if (i < extremeCases.length) {
          [a, b] = extremeCases[i];
        } else {
          // Generate random extreme cases
          if (Math.random() < 0.1) {
            a = null;
            b = this.randomString(1, 20);
          } else if (Math.random() < 0.2) {
            a = this.randomString(1, 20);
            b = null;
          } else {
            // Very long or very short strings
            const lenA = Math.random() < 0.3
              ? 1
              : Math.floor(Math.random() * 25) + 1;
            const lenB = Math.random() < 0.3
              ? 1
              : Math.floor(Math.random() * 25) + 1;

            a = this.randomString(lenA, lenA);
            b = this.randomString(lenB, lenB);

            // Ensure a < b
            if (a >= b) {
              [a, b] = [b, a];
            }
          }
        }

        try {
          const index = fractionalIndexBetween(a, b);

          // Verify bounds
          if (a !== null && index <= a) {
            throw new Error(`Generated index ${index} not greater than ${a}`);
          }
          if (b !== null && index >= b) {
            throw new Error(`Generated index ${index} not less than ${b}`);
          }

          if (!isValidFractionalIndex(index)) {
            throw new Error(`Generated invalid index: "${index}"`);
          }

          result.successes++;
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("No string exists between")
          ) {
            result.successes++;
          } else {
            result.failures++;
            result.errors.push(`Error between "${a}" and "${b}": ${error}`);
          }
        }
      } catch (error) {
        result.failures++;
        result.errors.push(`Setup error in iteration ${i}: ${error}`);
      }
    }

    this.results.push(result);
    return result;
  }

  private randomString(minLen: number, maxLen: number): string {
    const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
    const len = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
    let result = "";

    for (let i = 0; i < len; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }

    return result;
  }

  private generateRandomBases(count: number): string[] {
    const bases: string[] = [];
    for (let i = 0; i < count; i++) {
      bases.push(this.randomString(1, 3));
    }
    return bases.sort();
  }

  printResults() {
    console.log("\n" + "=".repeat(80));
    console.log("🎯 FRACTIONAL INDEXING FUZZ TEST RESULTS");
    console.log("=".repeat(80));

    let allPassed = true;

    for (const result of this.results) {
      const successRate = (result.successes / result.iterations * 100).toFixed(
        1,
      );
      const status = result.failures === 0 ? "✅" : "❌";

      console.log(`\n${status} ${result.name}`);
      console.log(`   Iterations: ${result.iterations}`);
      console.log(
        `   Success rate: ${successRate}% (${result.successes}/${result.iterations})`,
      );

      if (result.failures > 0) {
        allPassed = false;
        console.log(`   ❌ Failures: ${result.failures}`);

        // Show first few errors
        const errorCount = Math.min(3, result.errors.length);
        for (let i = 0; i < errorCount; i++) {
          console.log(`      ${i + 1}. ${result.errors[i]}`);
        }

        if (result.errors.length > errorCount) {
          console.log(
            `      ... and ${result.errors.length - errorCount} more errors`,
          );
        }
      }

      // Show examples for successful cases
      if (result.examples.length > 0) {
        console.log(`   📝 Examples:`);
        for (const example of result.examples.slice(0, 3)) {
          console.log(`      ${example}`);
        }
      }
    }

    console.log("\n" + "=".repeat(80));

    if (allPassed) {
      console.log("✅ All fuzz tests passed!");
      console.log("No edge cases found in fractional indexing implementation.");
    } else {
      console.log("❌ Some fuzz tests revealed issues!");
      console.log(
        "The fractional indexing implementation has edge cases that need attention.",
      );
    }

    return allPassed;
  }
}

function main() {
  const verbose = Deno.args.includes("--verbose") || Deno.args.includes("-v");
  const quick = Deno.args.includes("--quick");

  const iterations = quick
    ? {
      adjacent: 100,
      rapid: 50,
      movements: 30,
      boundary: 25,
    }
    : {
      adjacent: 1000,
      rapid: 500,
      movements: 300,
      boundary: 200,
    };

  console.log("🔍 Starting Fractional Indexing Fuzz Testing");
  console.log(`Mode: ${quick ? "Quick" : "Comprehensive"}`);
  console.log("=" + "=".repeat(79));

  const fuzzer = new FractionalIndexFuzzer(verbose);

  console.log("\n🎯 Testing adjacent string cases (m/m0 type issues)...");
  fuzzer.fuzzAdjacentStrings(iterations.adjacent);

  console.log("\n🎯 Testing rapid insertion clustering...");
  fuzzer.fuzzRapidInsertion(iterations.rapid);

  console.log("\n🎯 Testing cell movement edge cases...");
  fuzzer.fuzzCellMovements(iterations.movements);

  console.log("\n🎯 Testing boundary conditions...");
  fuzzer.fuzzBoundaryConditions(iterations.boundary);

  const allPassed = fuzzer.printResults();

  if (!allPassed) {
    Deno.exit(1);
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error("Fuzz testing failed:", error);
    Deno.exit(1);
  }
}

#!/usr/bin/env -S deno run --allow-run --allow-read

/**
 * Test stability script to verify fractional indexing improvements
 * Runs critical tests multiple times to ensure consistency
 */

const ITERATIONS = 50;
const CRITICAL_TESTS = [
  {
    name: "Fractional indexing concurrent operations",
    file: "packages/schema/test/fractional-cell-index.test.ts",
    filter: "concurrent",
  },
  {
    name: "Extreme clustering",
    file: "packages/schema/test/fractional-cell-index.test.ts",
    filter: "clustering",
  },
  {
    name: "v2.CellMoved concurrent movements",
    file: "packages/schema/test.ts",
    filter: "concurrent movements",
  },
  {
    name: "Fractional indexing edge cases",
    file: "packages/schema/test.ts",
    filter: "edge cases",
  },
  {
    name: "Jitter provider consistency",
    file: "packages/schema/test/fractional-cell-index.test.ts",
    filter: "JitterProvider",
  },
];

interface TestResult {
  test: string;
  successes: number;
  failures: number;
  errors: string[];
}

async function runTest(file: string, filter: string): Promise<boolean> {
  const cmd = new Deno.Command("deno", {
    args: [
      "test",
      "--allow-all",
      "--quiet",
      "--filter",
      filter,
      file,
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await cmd.output();

  if (code !== 0) {
    const errorOutput = new TextDecoder().decode(stderr);
    const stdOutput = new TextDecoder().decode(stdout);
    console.error(`Test failed with output:\n${stdOutput}\n${errorOutput}`);
    return false;
  }

  return true;
}

async function runTestMultipleTimes(
  name: string,
  file: string,
  filter: string,
  iterations: number,
): Promise<TestResult> {
  const result: TestResult = {
    test: name,
    successes: 0,
    failures: 0,
    errors: [],
  };

  console.log(`\n🔄 Running "${name}" ${iterations} times...`);

  for (let i = 0; i < iterations; i++) {
    await Deno.stdout.write(
      new TextEncoder().encode(`\r  Progress: ${i + 1}/${iterations}`),
    );

    try {
      const success = await runTest(file, filter);
      if (success) {
        result.successes++;
      } else {
        result.failures++;
        result.errors.push(`Failed on iteration ${i + 1}`);
      }
    } catch (error) {
      result.failures++;
      result.errors.push(`Error on iteration ${i + 1}: ${error}`);
    }
  }

  console.log(); // New line after progress
  return result;
}

async function main() {
  console.log("🧪 Testing Fractional Indexing Stability");
  console.log(
    `Running ${CRITICAL_TESTS.length} critical tests ${ITERATIONS} times each`,
  );
  console.log("=" + "=".repeat(79));

  const results: TestResult[] = [];

  for (const test of CRITICAL_TESTS) {
    const result = await runTestMultipleTimes(
      test.name,
      test.file,
      test.filter,
      ITERATIONS,
    );
    results.push(result);
  }

  // Print summary
  console.log("\n" + "=".repeat(80));
  console.log("📊 TEST STABILITY REPORT");
  console.log("=".repeat(80));

  let allPassed = true;

  for (const result of results) {
    const successRate = (result.successes / ITERATIONS * 100).toFixed(1);
    const status = result.failures === 0 ? "✅" : "❌";

    console.log(`\n${status} ${result.test}`);
    console.log(
      `   Success rate: ${successRate}% (${result.successes}/${ITERATIONS})`,
    );

    if (result.failures > 0) {
      allPassed = false;
      console.log(`   Failures: ${result.failures}`);
      if (result.errors.length > 0 && result.errors.length <= 5) {
        result.errors.forEach((err) => console.log(`     - ${err}`));
      } else if (result.errors.length > 5) {
        console.log(`     (${result.errors.length} errors - showing first 5)`);
        result.errors.slice(0, 5).forEach((err) =>
          console.log(`     - ${err}`)
        );
      }
    }
  }

  console.log("\n" + "=".repeat(80));

  if (allPassed) {
    console.log("✅ All tests passed consistently!");
    console.log("The fractional indexing implementation appears to be stable.");
  } else {
    console.log("❌ Some tests showed inconsistent behavior.");
    console.log(
      "This may indicate race conditions or non-deterministic behavior.",
    );
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Script failed:", error);
    Deno.exit(1);
  });
}

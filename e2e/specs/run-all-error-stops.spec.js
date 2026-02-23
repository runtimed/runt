/**
 * E2E Test: Run All Stops on First Error (Fixture)
 *
 * Opens a notebook with 3 code cells (10-run-all-error.ipynb):
 *   1. print("before_error")  — succeeds
 *   2. raise ValueError(...)  — errors
 *   3. print("after_error")   — should NOT execute
 *
 * Verifies that "Run All" stops execution after the first cell error
 * and does not execute subsequent cells.
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/10-run-all-error.ipynb
 */

import { browser, expect } from "@wdio/globals";
import {
  waitForAppReady,
  waitForErrorOutput,
  waitForKernelReady,
} from "../helpers.js";

/**
 * Wait for a specific cell (by index) to have stream output containing the expected text.
 */
async function waitForCellStreamOutput(
  cellIndex,
  expectedText,
  timeout = 120000,
) {
  const cells = await $$('[data-cell-type="code"]');
  const cell = cells[cellIndex];

  await browser.waitUntil(
    async () => {
      const output = await cell.$('[data-slot="ansi-stream-output"]');
      if (!(await output.isExisting())) return false;
      const text = await output.getText();
      return text.includes(expectedText);
    },
    {
      timeout,
      interval: 500,
      timeoutMsg: `Cell ${cellIndex} did not produce output containing "${expectedText}"`,
    },
  );

  const output = await cell.$('[data-slot="ansi-stream-output"]');
  return await output.getText();
}

describe("Run All Stops on First Error", () => {
  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());
  });

  it("should have 3 pre-populated code cells", async () => {
    const cells = await $$('[data-cell-type="code"]');
    console.log("Code cells found:", cells.length);
    expect(cells.length).toBe(3);
  });

  it("should stop execution on first error and skip remaining cells", async () => {
    // Start the kernel explicitly if it hasn't auto-launched yet
    const startButton = await $('[data-testid="start-kernel-button"]');
    if (await startButton.isExisting()) {
      await startButton.click();
      console.log("Clicked Start Kernel");
    }
    await waitForKernelReady();
    console.log("Kernel ready");

    const runAllButton = await $('[data-testid="run-all-button"]');
    await runAllButton.waitForClickable({ timeout: 5000 });
    await runAllButton.click();
    console.log("Clicked Run All");

    // Cell 1 should execute successfully
    const output1 = await waitForCellStreamOutput(0, "before_error");
    console.log("Cell 1 output:", output1);
    expect(output1).toContain("before_error");

    // Cell 2 should produce an error
    const cells = await $$('[data-cell-type="code"]');
    await waitForErrorOutput(cells[1]);
    console.log("Cell 2 produced error output");

    // Wait a moment for the queue to settle
    await browser.pause(2000);

    // Cell 3 should NOT have any output (execution stopped)
    const cell3 = cells[2];
    const streamOutput = await cell3.$('[data-slot="ansi-stream-output"]');
    const errorOutput = await cell3.$('[data-slot="ansi-error-output"]');

    const hasStreamOutput = await streamOutput.isExisting();
    const hasErrorOutput = await errorOutput.isExisting();

    console.log("Cell 3 has stream output:", hasStreamOutput);
    console.log("Cell 3 has error output:", hasErrorOutput);

    expect(hasStreamOutput).toBe(false);
    expect(hasErrorOutput).toBe(false);
  });
});

/**
 * E2E Test: Run All Cells and Restart & Run All (Fixture)
 *
 * Opens a notebook with 3 code cells and no dependencies (8-multi-cell.ipynb).
 * Verifies "Run All" executes all cells in order, and "Restart & Run All"
 * clears outputs and re-executes everything.
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/8-multi-cell.ipynb
 */

import { browser, expect } from "@wdio/globals";
import { waitForAppReady, waitForKernelReady } from "../helpers.js";

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

describe("Run All Cells", () => {
  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());
  });

  it("should have 3 pre-populated code cells", async () => {
    const cells = await $$('[data-cell-type="code"]');
    console.log("Code cells found:", cells.length);
    expect(cells.length).toBe(3);
  });

  it("should execute all cells with Run All", async () => {
    // Start the kernel explicitly if it hasn't auto-launched yet
    const startButton = await $('[data-testid="start-kernel-button"]');
    if (await startButton.isExisting()) {
      await startButton.click();
      console.log("Clicked Start Kernel");
    }
    await waitForKernelReady(60000); // Allow 60s for CI kernel startup
    console.log("Kernel ready");

    const runAllButton = await $('[data-testid="run-all-button"]');
    await runAllButton.waitForClickable({ timeout: 5000 });
    await runAllButton.click();
    console.log("Clicked Run All");

    // Wait for all 3 cells to produce correct output
    const output1 = await waitForCellStreamOutput(0, "cell1: 42");
    console.log("Cell 1 output:", output1);
    expect(output1).toContain("cell1: 42");

    const output2 = await waitForCellStreamOutput(1, "cell2: 84");
    console.log("Cell 2 output:", output2);
    expect(output2).toContain("cell2: 84");

    const output3 = await waitForCellStreamOutput(2, "cell3: done");
    console.log("Cell 3 output:", output3);
    expect(output3).toContain("cell3: done");
  });

  it("should restart and re-execute all cells", async () => {
    const restartRunAllButton = await $(
      '[data-testid="restart-run-all-button"]',
    );
    await restartRunAllButton.waitForClickable({ timeout: 5000 });
    await restartRunAllButton.click();
    console.log("Clicked Restart & Run All");

    // Wait for outputs to clear (kernel restarts, outputs get wiped)
    await browser.waitUntil(
      async () => {
        const cells = await $$('[data-cell-type="code"]');
        for (const cell of cells) {
          const output = await cell.$('[data-slot="ansi-stream-output"]');
          if (await output.isExisting()) return false;
        }
        return true;
      },
      {
        timeout: 15000,
        interval: 300,
        timeoutMsg: "Outputs did not clear after Restart & Run All",
      },
    );
    console.log("Outputs cleared");

    // Wait for all cells to re-execute with correct outputs
    const output1 = await waitForCellStreamOutput(0, "cell1: 42");
    console.log("Cell 1 re-executed:", output1);
    expect(output1).toContain("cell1: 42");

    const output2 = await waitForCellStreamOutput(1, "cell2: 84");
    console.log("Cell 2 re-executed:", output2);
    expect(output2).toContain("cell2: 84");

    const output3 = await waitForCellStreamOutput(2, "cell3: done");
    console.log("Cell 3 re-executed:", output3);
    expect(output3).toContain("cell3: done");
  });
});

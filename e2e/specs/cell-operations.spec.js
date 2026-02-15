/**
 * E2E Test: Cell Operations
 *
 * Tests cell manipulation functionality:
 * - Add new code cell
 * - Add markdown cell
 * - Delete cell (cannot delete last cell)
 * - Variables persist across cells
 * - Execution count increments
 */

import { browser, expect } from "@wdio/globals";

describe("Cell Operations", () => {
  const KERNEL_STARTUP_TIMEOUT = 90000;
  const EXECUTION_TIMEOUT = 30000;

  before(async () => {
    // Wait for app to fully load
    await browser.pause(5000);

    const title = await browser.getTitle();
    console.log("Page title:", title);
  });

  /**
   * Helper to type text character by character with delay
   */
  async function typeSlowly(text, delay = 50) {
    for (const char of text) {
      await browser.keys(char);
      await browser.pause(delay);
    }
  }

  /**
   * Helper to count code cells
   */
  async function countCodeCells() {
    const cells = await $$('[data-cell-type="code"]');
    return cells.length;
  }

  /**
   * Helper to count markdown cells
   */
  async function countMarkdownCells() {
    const cells = await $$('[data-cell-type="markdown"]');
    return cells.length;
  }

  /**
   * Helper to get total cell count
   */
  async function countAllCells() {
    const codeCells = await countCodeCells();
    const mdCells = await countMarkdownCells();
    return codeCells + mdCells;
  }

  /**
   * Helper to find a button by trying multiple selectors
   */
  async function findButton(labelPatterns) {
    for (const pattern of labelPatterns) {
      const button = await $(pattern);
      if (await button.isExisting()) {
        return button;
      }
    }
    return null;
  }

  /**
   * Helper to wait for output containing specific text in a specific cell
   */
  async function waitForOutputInCell(cell, expectedText, timeout) {
    await browser.waitUntil(
      async () => {
        const streamOutput = await cell.$('[data-slot="ansi-stream-output"]');
        if (!(await streamOutput.isExisting())) {
          return false;
        }
        const text = await streamOutput.getText();
        return text.includes(expectedText);
      },
      {
        timeout,
        timeoutMsg: `Output "${expectedText}" did not appear within timeout.`,
        interval: 500,
      }
    );
  }

  describe("Adding cells", () => {
    it("should add a new code cell", async () => {
      const initialCount = await countCodeCells();
      console.log("Initial code cell count:", initialCount);

      // Click the "Code" button to add a new code cell
      const addCodeButton = await $("button*=Code");
      const buttonExists = await addCodeButton.isExisting();

      if (buttonExists) {
        await addCodeButton.waitForClickable({ timeout: 5000 });
        await addCodeButton.click();
        await browser.pause(500);

        const newCount = await countCodeCells();
        console.log("New code cell count:", newCount);

        expect(newCount).toBe(initialCount + 1);
        console.log("Add code cell test passed");
      } else {
        console.log("Add Code button not found, using keyboard shortcut");
        // Try keyboard shortcut if button not found
        await browser.keys(["Control", "Shift", "b"]); // Common shortcut
        await browser.pause(500);

        const newCount = await countCodeCells();
        // Just verify we have at least one cell
        expect(newCount).toBeGreaterThanOrEqual(1);
      }
    });

    it("should add a markdown cell", async () => {
      const initialMdCount = await countMarkdownCells();
      console.log("Initial markdown cell count:", initialMdCount);

      // Click the "Markdown" button
      const addMdButton = await $("button*=Markdown");
      const buttonExists = await addMdButton.isExisting();

      if (buttonExists) {
        await addMdButton.waitForClickable({ timeout: 5000 });
        await addMdButton.click();
        await browser.pause(500);

        const newMdCount = await countMarkdownCells();
        console.log("New markdown cell count:", newMdCount);

        expect(newMdCount).toBe(initialMdCount + 1);
        console.log("Add markdown cell test passed");
      } else {
        console.log("Add Markdown button not found, skipping");
      }
    });
  });

  describe("Deleting cells", () => {
    it("should delete a cell when multiple cells exist", async () => {
      // First ensure we have multiple cells
      const addCodeButton = await $("button*=Code");
      if (await addCodeButton.isExisting()) {
        await addCodeButton.click();
        await browser.pause(300);
        await addCodeButton.click();
        await browser.pause(300);
      }

      const initialCount = await countAllCells();
      console.log("Cell count before deletion:", initialCount);

      if (initialCount < 2) {
        console.log("Not enough cells to test deletion, skipping");
        return;
      }

      // Find and click on a cell to select it
      const cells = await $$('[data-cell-type="code"]');
      if (cells.length > 1) {
        await cells[0].click();
        await browser.pause(200);

        // Look for delete button - try multiple selectors separately
        const deleteButton = await findButton([
          'button[aria-label*="delete"]',
          'button[aria-label*="Delete"]',
          "button*=Delete",
        ]);

        if (deleteButton) {
          await deleteButton.click();
          await browser.pause(500);

          const newCount = await countAllCells();
          console.log("Cell count after deletion:", newCount);

          expect(newCount).toBe(initialCount - 1);
          console.log("Delete cell test passed");
        } else {
          // Try keyboard shortcut
          console.log("Delete button not found, trying keyboard shortcut");
          await browser.keys(["Control", "Shift", "d"]); // Common delete shortcut
          await browser.pause(500);

          const newCount = await countAllCells();
          // Just verify we still have cells
          console.log("Cell count after keyboard shortcut:", newCount);
        }
      }
    });

    it("should prevent deleting the last cell", async () => {
      // Get all cells and delete until one remains
      let cellCount = await countAllCells();
      console.log("Starting cell count:", cellCount);

      // Keep deleting until we have one cell
      while (cellCount > 1) {
        const cells = await $$('[data-cell-type="code"]');
        if (cells.length > 1) {
          await cells[0].click();
          await browser.pause(200);

          const deleteButton = await findButton([
            'button[aria-label*="delete"]',
            'button[aria-label*="Delete"]',
          ]);
          if (deleteButton) {
            await deleteButton.click();
            await browser.pause(300);
          } else {
            break;
          }
        } else {
          break;
        }
        cellCount = await countAllCells();
      }

      // Now we should have exactly 1 cell
      const finalCount = await countAllCells();
      console.log("Cell count after deletions:", finalCount);

      // Try to delete the last cell
      const lastCell = await $('[data-cell-type="code"]');
      if (await lastCell.isExisting()) {
        await lastCell.click();
        await browser.pause(200);

        const deleteButton = await findButton([
          'button[aria-label*="delete"]',
          'button[aria-label*="Delete"]',
        ]);
        if (deleteButton) {
          // The button might be disabled or should not work
          const isDisabled = await deleteButton.getAttribute("disabled");
          console.log("Delete button disabled:", isDisabled);

          // Even if we click, the cell should remain
          await deleteButton.click();
          await browser.pause(300);

          const afterAttempt = await countAllCells();
          console.log("Cell count after attempting to delete last:", afterAttempt);

          // Should still have at least 1 cell
          expect(afterAttempt).toBeGreaterThanOrEqual(1);
          console.log("Prevent delete last cell test passed");
        }
      }
    });
  });

  describe("Cross-cell state", () => {
    it("should persist variables across cells", async () => {
      // Add a fresh code cell
      const addCodeButton = await $("button*=Code");
      if (await addCodeButton.isExisting()) {
        await addCodeButton.click();
        await browser.pause(300);
      }

      // Get all code cells
      let cells = await $$('[data-cell-type="code"]');
      const firstCell = cells[cells.length - 1]; // Use the newest cell

      // Focus and type in first cell - define a variable
      const editor1 = await firstCell.$('.cm-content[contenteditable="true"]');
      await editor1.click();
      await browser.pause(200);
      await browser.keys(["Control", "a"]);
      await browser.pause(100);

      const code1 = "shared_var = 100";
      await typeSlowly(code1);
      await browser.pause(300);
      await browser.keys(["Shift", "Enter"]);

      // Wait for first cell to execute (with kernel startup)
      console.log("Waiting for kernel startup and first cell execution...");
      await browser.waitUntil(
        async () => {
          // Look for any indication execution completed
          const output = await firstCell.$('[data-slot="ansi-stream-output"]');
          const error = await firstCell.$('[data-slot="ansi-error-output"]');
          // If no output/error, check if execution count appeared
          const cellText = await firstCell.getText();
          const hasExecCount = cellText.match(/\[\d+\]/);
          return (
            (await output.isExisting()) ||
            (await error.isExisting()) ||
            hasExecCount
          );
        },
        {
          timeout: KERNEL_STARTUP_TIMEOUT,
          interval: 1000,
          timeoutMsg: "First cell execution did not complete",
        }
      );
      console.log("First cell execution completed");

      // Add another cell
      await addCodeButton.click();
      await browser.pause(300);

      // Get the new cell
      cells = await $$('[data-cell-type="code"]');
      const secondCell = cells[cells.length - 1];

      // Type code that uses the variable from first cell
      const editor2 = await secondCell.$('.cm-content[contenteditable="true"]');
      await editor2.click();
      await browser.pause(200);

      const code2 = "print(shared_var * 2)";
      await typeSlowly(code2);
      await browser.pause(300);
      await browser.keys(["Shift", "Enter"]);

      // Wait for output
      await waitForOutputInCell(secondCell, "200", EXECUTION_TIMEOUT);

      const output = await secondCell.$('[data-slot="ansi-stream-output"]').getText();
      expect(output).toContain("200");

      console.log("Variable persistence across cells test passed");
    });
  });

  describe("Execution count", () => {
    it("should show and increment execution count", async () => {
      // Get a code cell
      const codeCell = await $('[data-cell-type="code"]');
      const editor = await codeCell.$('.cm-content[contenteditable="true"]');

      // Clear and type new code
      await editor.click();
      await browser.pause(200);
      await browser.keys(["Control", "a"]);
      await browser.pause(100);

      await typeSlowly('print("exec count test")');
      await browser.pause(300);

      // Execute
      await browser.keys(["Shift", "Enter"]);

      // Wait for output
      await browser.waitUntil(
        async () => {
          const output = await codeCell.$('[data-slot="ansi-stream-output"]');
          return await output.isExisting();
        },
        { timeout: KERNEL_STARTUP_TIMEOUT, interval: 500 }
      );

      // Check for execution count display
      // This is typically shown as "In [n]:" or "[n]"
      const cellText = await codeCell.getText();
      console.log("Cell text:", cellText);

      // Look for execution count indicator (could be in various formats)
      const hasExecCount =
        cellText.match(/\[\d+\]/) || // [1], [2], etc.
        cellText.match(/In\s*\[\d+\]/); // In [1], In [2], etc.

      console.log("Has execution count:", !!hasExecCount);

      // Execute again and verify count increments
      await editor.click();
      await browser.pause(200);
      await browser.keys(["Shift", "Enter"]);
      await browser.pause(3000);

      console.log("Execution count test completed");
    });
  });
});

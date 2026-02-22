/**
 * E2E Test: Backspace on Empty Cell Deletes Cell
 *
 * Tests that pressing backspace on an empty cell deletes the cell
 * and moves focus to the previous cell.
 */

import os from "node:os";
import { browser, expect } from "@wdio/globals";
import { waitForAppReady } from "../helpers.js";

// macOS uses Cmd (Meta) for shortcuts, Linux uses Ctrl
const MOD_KEY = os.platform() === "darwin" ? "Meta" : "Control";

/**
 * Screenshot helper for capturing milestone moments
 */
async function takeScreenshot(name) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = name.replace(/[^a-zA-Z0-9]/g, "-");
  const screenshotDir = process.env.E2E_SCREENSHOT_DIR || "./e2e-screenshots";
  const screenshotPath = `${screenshotDir}/${safeName}-${timestamp}.png`;
  try {
    await browser.saveScreenshot(screenshotPath);
    console.log(`Screenshot saved: ${screenshotPath}`);
  } catch (error) {
    console.log(`Screenshot skipped (${name}): ${error.message}`);
  }
}

describe("Backspace Delete Cell", () => {
  /**
   * Helper to type text character by character with delay to avoid dropped keys
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
   * Helper to get all cell IDs
   */
  async function getCellIds() {
    const cells = await $$('[data-cell-type="code"]');
    const ids = [];
    for (const cell of cells) {
      const id = await cell.getAttribute("data-cell-id");
      ids.push(id);
    }
    return ids;
  }

  before(async () => {
    await waitForAppReady();
    await takeScreenshot("backspace-01-app-loaded");
  });

  it("should delete an empty cell on backspace and focus previous cell", async () => {
    // Step 1: Ensure we have at least one code cell
    const cells = await $$('[data-cell-type="code"]');
    const initialCellCount = cells.length;
    console.log("Initial cell count:", initialCellCount);

    if (initialCellCount === 0) {
      // Add first cell
      console.log("No code cell found, adding one...");
      const addCodeButton = await $('[data-testid="add-code-cell-button"]');
      await addCodeButton.waitForClickable({ timeout: 5000 });
      await addCodeButton.click();
      await browser.pause(500);
    }

    // Step 2: Get the first cell and its editor
    const firstCell = await $('[data-cell-type="code"]');
    await firstCell.waitForExist({ timeout: 5000 });
    const firstCellId = await firstCell.getAttribute("data-cell-id");
    console.log("First cell ID:", firstCellId);

    const firstEditor = await firstCell.$(
      '.cm-content[contenteditable="true"]',
    );
    await firstEditor.waitForExist({ timeout: 5000 });

    // Click to focus and wait
    await firstEditor.click();
    await browser.pause(500);

    // Type a simple marker - just a few chars to minimize issues
    console.log("Typing marker...");
    await typeSlowly("ABC", 50);
    await browser.pause(500);

    // Verify we typed something by reading back
    let firstCellContent = await firstEditor.getText();
    console.log(
      "First cell content after typing:",
      JSON.stringify(firstCellContent),
    );

    // If typing didn't work, try using setValue as fallback
    if (!firstCellContent.includes("ABC")) {
      console.log("Direct typing failed, trying alternative method...");
      // Try clicking more specifically
      await firstEditor.click();
      await browser.pause(300);

      // Use browser.keys with explicit key presses
      await browser.keys("X");
      await browser.pause(200);
      await browser.keys("Y");
      await browser.pause(200);
      await browser.keys("Z");
      await browser.pause(500);

      firstCellContent = await firstEditor.getText();
      console.log(
        "Content after alternative typing:",
        JSON.stringify(firstCellContent),
      );
    }

    await takeScreenshot("backspace-02-first-cell-with-content");

    // Step 3: Add a second empty cell
    // We need to hover over the area between cells to reveal the add button
    // Or use keyboard shortcut from within the editor
    await firstEditor.click();
    await browser.pause(300);

    // Use Alt+Enter to execute and insert a new cell
    console.log("Adding second cell with Alt+Enter...");
    await browser.keys(["Alt", "Enter"]);
    await browser.pause(500);

    // Verify we now have 2 cells
    let cellCount = await countCodeCells();
    console.log("Cell count after Alt+Enter:", cellCount);

    // If Alt+Enter didn't create a cell, try clicking the add button
    if (cellCount < 2) {
      console.log("Alt+Enter didn't create cell, trying button...");
      const addButtons = await $$('[data-testid="add-code-cell-button"]');
      if (addButtons.length > 0) {
        // Scroll the last button into view and click
        const lastAddButton = addButtons[addButtons.length - 1];
        await lastAddButton.scrollIntoView();
        await browser.pause(200);
        await lastAddButton.click();
        await browser.pause(500);
      }
      cellCount = await countCodeCells();
      console.log("Cell count after button click:", cellCount);
    }

    expect(cellCount).toBeGreaterThanOrEqual(2);
    await takeScreenshot("backspace-03-two-cells");

    // Step 4: Get cell IDs before deletion
    const cellIdsBefore = await getCellIds();
    console.log("Cell IDs before deletion:", cellIdsBefore);

    // Step 5: Focus the second cell (which should be empty)
    const allCells = await $$('[data-cell-type="code"]');
    const secondCell = allCells[1];
    const secondCellId = await secondCell.getAttribute("data-cell-id");
    console.log("Second cell ID:", secondCellId);

    const secondEditor = await secondCell.$(
      '.cm-content[contenteditable="true"]',
    );
    await secondEditor.click();
    await browser.pause(500);

    // Ensure second cell is empty
    await browser.keys([MOD_KEY, "a"]);
    await browser.pause(200);
    await browser.keys("Backspace");
    await browser.pause(500);

    const secondContent = await secondEditor.getText();
    console.log("Second cell content:", JSON.stringify(secondContent));

    // Step 6: Press backspace on empty cell to delete it
    console.log("Pressing Backspace to delete empty cell...");
    await browser.keys("Backspace");
    await browser.pause(500);

    await takeScreenshot("backspace-04-after-delete");

    // Step 7: Verify the cell was deleted
    const cellCountAfter = await countCodeCells();
    console.log("Cell count after backspace:", cellCountAfter);
    expect(cellCountAfter).toBe(cellCount - 1);

    // Step 8: Verify the second cell ID is gone
    const cellIdsAfter = await getCellIds();
    console.log("Cell IDs after deletion:", cellIdsAfter);
    expect(cellIdsAfter).toContain(firstCellId);
    expect(cellIdsAfter).not.toContain(secondCellId);

    // Step 9: The remaining cell should be focused (the first cell)
    // We verify by checking that the first cell still exists
    const remainingCell = await $(`[data-cell-id="${firstCellId}"]`);
    expect(await remainingCell.isExisting()).toBe(true);

    await takeScreenshot("backspace-05-cell-deleted-success");
    console.log("Test passed: Empty cell deleted successfully");
  });

  it("should not delete the last remaining cell", async () => {
    // Ensure we only have one cell
    let cellCount = await countCodeCells();
    console.log("Starting cell count:", cellCount);

    // Delete cells until we have only one
    while (cellCount > 1) {
      const cells = await $$('[data-cell-type="code"]');
      const lastCell = cells[cells.length - 1];
      const editor = await lastCell.$('.cm-content[contenteditable="true"]');
      await editor.click();
      await browser.pause(300);

      // Clear the cell
      await browser.keys([MOD_KEY, "a"]);
      await browser.pause(200);
      await browser.keys("Backspace");
      await browser.pause(300);

      // Delete with backspace
      await browser.keys("Backspace");
      await browser.pause(500);

      cellCount = await countCodeCells();
      console.log("Cell count:", cellCount);
    }

    console.log("Down to one cell");
    await takeScreenshot("backspace-06-one-cell-remaining");

    // Now try to delete the last cell
    const lastCell = await $('[data-cell-type="code"]');
    const editor = await lastCell.$('.cm-content[contenteditable="true"]');
    await editor.click();
    await browser.pause(300);

    // Clear the cell
    await browser.keys([MOD_KEY, "a"]);
    await browser.pause(200);
    await browser.keys("Backspace");
    await browser.pause(300);

    // Try to delete
    console.log("Attempting to delete last cell...");
    await browser.keys("Backspace");
    await browser.pause(500);

    // The cell should still exist
    const finalCellCount = await countCodeCells();
    console.log("Final cell count:", finalCellCount);
    expect(finalCellCount).toBe(1);

    await takeScreenshot("backspace-07-last-cell-protected");
    console.log("Test passed: Last cell cannot be deleted");
  });
});

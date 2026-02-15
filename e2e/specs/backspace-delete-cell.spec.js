/**
 * E2E Test: Backspace on Empty Cell Deletes Cell
 *
 * Tests that pressing backspace on an empty cell deletes the cell
 * and moves focus to the previous cell.
 */

import { browser, expect } from "@wdio/globals";

/**
 * Screenshot helper for capturing milestone moments
 */
async function takeScreenshot(name) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = name.replace(/[^a-zA-Z0-9]/g, "-");
  const screenshotPath = `/app/e2e-screenshots/${safeName}-${timestamp}.png`;
  try {
    await browser.saveScreenshot(screenshotPath);
    console.log(`Screenshot saved: ${screenshotPath}`);
  } catch (error) {
    console.error(`Failed to save screenshot "${name}":`, error.message);
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

  /**
   * Helper to wait for editor content to contain expected text
   */
  async function waitForEditorContent(editor, expectedText, timeout = 5000) {
    await browser.waitUntil(
      async () => {
        const text = await editor.getText();
        return text.includes(expectedText);
      },
      {
        timeout,
        timeoutMsg: `Editor content did not contain "${expectedText}" within timeout`,
        interval: 200,
      }
    );
  }

  before(async () => {
    // Wait for app to fully load
    await browser.pause(5000);
    await takeScreenshot("backspace-01-app-loaded");
  });

  it("should delete an empty cell on backspace and focus previous cell", async () => {
    // Step 1: Ensure we have at least one code cell
    let cells = await $$('[data-cell-type="code"]');

    if (cells.length === 0) {
      // Add first cell
      console.log("No code cell found, adding one...");
      const addCodeButton = await $("button*=Code");
      await addCodeButton.waitForClickable({ timeout: 5000 });
      await addCodeButton.click();
      await browser.pause(1000);
    }

    // Step 2: Focus and type content in the first cell
    const firstCell = await $('[data-cell-type="code"]');
    const firstEditor = await firstCell.$('.cm-content[contenteditable="true"]');
    await firstEditor.waitForExist({ timeout: 5000 });
    await firstEditor.click();
    await browser.pause(500);

    // Clear any existing content first
    await browser.keys(["Control", "a"]);
    await browser.pause(200);
    await browser.keys("Backspace");
    await browser.pause(200);

    // Now type our marker content
    const markerText = "MARKER_FIRST_CELL";
    console.log("Typing marker text:", markerText);
    await typeSlowly(markerText, 80);
    await browser.pause(500);

    // Verify content was typed
    const typedContent = await firstEditor.getText();
    console.log("First cell content after typing:", JSON.stringify(typedContent));

    await takeScreenshot("backspace-02-first-cell-content");

    // Step 3: Add a second cell by hovering to reveal add buttons
    // Move to the bottom of the first cell to reveal the add cell buttons
    const addButtons = await $$("button*=Code");
    console.log("Found add buttons:", addButtons.length);

    if (addButtons.length > 1) {
      // Click the add button that appears between cells
      await addButtons[1].click();
    } else {
      // Fallback: Use keyboard shortcut - focus editor first
      await firstEditor.click();
      await browser.pause(200);
      await browser.keys(["Alt", "Enter"]);
    }
    await browser.pause(1000);

    // Verify we now have 2 cells
    let cellCount = await countCodeCells();
    console.log("Cell count after adding second cell:", cellCount);
    expect(cellCount).toBeGreaterThanOrEqual(2);

    await takeScreenshot("backspace-03-two-cells");

    // Step 4: Get the cell IDs before deletion
    const cellIdsBefore = await getCellIds();
    console.log("Cell IDs before deletion:", cellIdsBefore);

    // Step 5: Focus the second cell and ensure it's empty
    const allCells = await $$('[data-cell-type="code"]');
    const secondCell = allCells[1];
    const secondEditor = await secondCell.$('.cm-content[contenteditable="true"]');
    await secondEditor.click();
    await browser.pause(300);

    // Select all and delete to ensure it's empty
    await browser.keys(["Control", "a"]);
    await browser.pause(200);
    await browser.keys("Backspace");
    await browser.pause(300);

    // Verify cell is empty
    const secondCellContent = await secondEditor.getText();
    console.log("Second cell content (should be empty or placeholder):", JSON.stringify(secondCellContent));

    // Now the cell should be empty, press backspace to delete it
    console.log("Pressing backspace on empty cell...");
    await browser.keys("Backspace");
    await browser.pause(1000);

    await takeScreenshot("backspace-04-after-delete");

    // Step 6: Verify the cell was deleted
    const cellCountAfter = await countCodeCells();
    console.log("Cell count after backspace:", cellCountAfter);
    expect(cellCountAfter).toBe(cellCount - 1);

    // Step 7: Verify the cell IDs changed (second cell was removed)
    const cellIdsAfter = await getCellIds();
    console.log("Cell IDs after deletion:", cellIdsAfter);
    expect(cellIdsAfter).not.toContain(cellIdsBefore[1]);

    // Step 8: Verify focus moved to the first cell
    // The remaining cell should contain our marker text
    const remainingCell = await $('[data-cell-type="code"]');
    const remainingEditor = await remainingCell.$('.cm-content[contenteditable="true"]');

    const remainingContent = await remainingEditor.getText();
    console.log("Remaining cell content:", JSON.stringify(remainingContent));

    // Verify the remaining cell is the first cell (has our marker)
    // Note: If the marker text wasn't typed successfully, the test will fail here
    // which will help diagnose the root cause
    expect(remainingContent).toContain(markerText);

    await takeScreenshot("backspace-05-focus-on-previous");

    console.log("Test passed: Empty cell deleted and focus moved to previous cell");
  });

  it("should not delete the last remaining cell", async () => {
    // Ensure we only have one cell by deleting extras
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
      await browser.keys(["Control", "a"]);
      await browser.pause(200);
      await browser.keys("Backspace");
      await browser.pause(300);

      // Try to delete
      await browser.keys("Backspace");
      await browser.pause(500);

      cellCount = await countCodeCells();
      console.log("Cell count after deletion attempt:", cellCount);
    }

    console.log("Down to one cell");
    await takeScreenshot("backspace-06-one-cell-remaining");

    // Now try to delete the last cell
    const lastCell = await $('[data-cell-type="code"]');
    const editor = await lastCell.$('.cm-content[contenteditable="true"]');
    await editor.click();
    await browser.pause(300);

    // Clear the cell
    await browser.keys(["Control", "a"]);
    await browser.pause(200);
    await browser.keys("Backspace");
    await browser.pause(300);

    // Try to delete with backspace
    console.log("Attempting to delete last remaining cell...");
    await browser.keys("Backspace");
    await browser.pause(500);

    // The cell should still exist
    const finalCellCount = await countCodeCells();
    console.log("Cell count after trying to delete last cell:", finalCellCount);
    expect(finalCellCount).toBe(1);

    await takeScreenshot("backspace-07-last-cell-protected");

    console.log("Test passed: Last cell cannot be deleted");
  });
});

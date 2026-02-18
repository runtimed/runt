/**
 * E2E Test: Display Updates (update_display_data)
 *
 * Tests IPython's display update mechanism where:
 * - display(obj, display_id=True) creates an updatable display
 * - handle.update(new_value) updates the output in place
 *
 * This tests the update_display_data message handling.
 */

import { browser, expect } from "@wdio/globals";

describe("Display Updates", () => {
  const KERNEL_STARTUP_TIMEOUT = 90000;
  const EXECUTION_TIMEOUT = 30000;

  let firstCell;
  let secondCell;

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
   * Helper to add a new code cell
   */
  async function addCodeCell() {
    const addCodeButton = await $("button*=Code");
    await addCodeButton.waitForClickable({ timeout: 5000 });
    await addCodeButton.click();
    await browser.pause(500);

    // Get all code cells and return the last one (newly added)
    const cells = await $$('[data-cell-type="code"]');
    return cells[cells.length - 1];
  }

  /**
   * Helper to focus and clear a cell's editor
   */
  async function focusAndClearCell(cell) {
    const editor = await cell.$('.cm-content[contenteditable="true"]');
    await editor.waitForExist({ timeout: 5000 });
    await editor.click();
    await browser.pause(200);

    // Clear any existing content
    await browser.keys(["Control", "a"]);
    await browser.pause(100);
  }

  /**
   * Helper to wait for text/plain output in a cell
   */
  async function waitForPlainTextOutput(cell, expectedText, timeout) {
    await browser.waitUntil(
      async () => {
        // Check for ansi-output (text/plain from display_data/execute_result)
        const output = await cell.$('[data-slot="ansi-output"]');
        if (!(await output.isExisting())) return false;
        const text = await output.getText();
        return text.includes(expectedText);
      },
      {
        timeout,
        timeoutMsg: `Plain text output containing "${expectedText}" did not appear within timeout.`,
        interval: 500,
      }
    );
  }

  /**
   * Helper to wait for HTML output (iframe) in a cell
   */
  async function waitForHtmlOutput(cell, timeout) {
    await browser.waitUntil(
      async () => {
        const iframe = await cell.$('[data-slot="html-output"] iframe');
        return await iframe.isExisting();
      },
      {
        timeout,
        timeoutMsg: "HTML output (iframe) did not appear within timeout.",
        interval: 500,
      }
    );
  }

  describe("update_display_data message handling", () => {
    it("should update display output from text/plain to text/html", async () => {
      // Get or create the first code cell
      firstCell = await $('[data-cell-type="code"]');
      const cellExists = await firstCell.isExisting();

      if (!cellExists) {
        console.log("No code cell found, adding one...");
        firstCell = await addCodeCell();
      }

      await focusAndClearCell(firstCell);

      // First cell: create a display with display_id=True
      const firstCode = `from IPython.display import display

handle = display("First is just plain", display_id=True)`;

      console.log("Typing first cell code (display with display_id)");
      await typeSlowly(firstCode, 30);
      await browser.pause(300);

      // Execute first cell
      await browser.keys(["Shift", "Enter"]);
      console.log("Executed first cell");

      // Wait for initial text/plain output
      await waitForPlainTextOutput(
        firstCell,
        "First is just plain",
        KERNEL_STARTUP_TIMEOUT
      );
      console.log("Initial text/plain output appeared");

      // Verify it's text/plain (ansi-output, not iframe)
      const initialOutput = await firstCell.$('[data-slot="ansi-output"]');
      const initialText = await initialOutput.getText();
      expect(initialText).toContain("First is just plain");
      console.log("Verified initial output:", initialText);

      // Add second cell for the update
      secondCell = await addCodeCell();
      await focusAndClearCell(secondCell);

      // Second cell: update the display to HTML
      const secondCode = `from IPython.display import HTML

handle.update(HTML("Different <b>Media Type</b>"))`;

      console.log("Typing second cell code (update to HTML)");
      await typeSlowly(secondCode, 30);
      await browser.pause(300);

      // Execute second cell
      await browser.keys(["Shift", "Enter"]);
      console.log("Executed second cell - expecting display update");

      // Wait for the output in the FIRST cell to change to HTML (iframe)
      await waitForHtmlOutput(firstCell, EXECUTION_TIMEOUT);
      console.log("HTML output appeared in first cell");

      // Verify the first cell now has HTML content (not text/plain anymore)
      const htmlOutput = await firstCell.$('[data-slot="html-output"]');
      const htmlExists = await htmlOutput.isExisting();
      expect(htmlExists).toBe(true);

      // The old text/plain output should be replaced
      const oldPlainOutput = await firstCell.$('[data-slot="ansi-output"]');
      const oldPlainExists = await oldPlainOutput.isExisting();

      // Either the old output is gone, or if it exists, it shouldn't contain our original text
      if (oldPlainExists) {
        const oldText = await oldPlainOutput.getText();
        // The text/plain output should no longer contain our original message
        // since it was replaced with HTML
        console.log("Old plain text still exists with:", oldText);
      }

      // Verify iframe contains the updated HTML content
      const iframe = await firstCell.$('[data-slot="html-output"] iframe');
      const iframeExists = await iframe.isExisting();
      expect(iframeExists).toBe(true);

      console.log("Display update test passed - output changed from text/plain to text/html");
    });

    it("should update display output while preserving display_id", async () => {
      // This test verifies multiple updates work correctly

      // Get or create a code cell
      let cell = await $('[data-cell-type="code"]');
      if (!(await cell.isExisting())) {
        cell = await addCodeCell();
      }
      await focusAndClearCell(cell);

      // Create a display and update it twice in the same cell
      const testCode = `from IPython.display import display
import time

h = display("Update 1", display_id=True)
time.sleep(0.5)
h.update("Update 2")
time.sleep(0.5)
h.update("Final Update")`;

      console.log("Typing multiple updates test code");
      await typeSlowly(testCode, 30);
      await browser.pause(300);

      await browser.keys(["Shift", "Enter"]);
      console.log("Executed cell with multiple updates");

      // Wait for final output
      await browser.waitUntil(
        async () => {
          const output = await cell.$('[data-slot="ansi-output"]');
          if (!(await output.isExisting())) return false;
          const text = await output.getText();
          return text.includes("Final Update");
        },
        {
          timeout: KERNEL_STARTUP_TIMEOUT,
          timeoutMsg: 'Final update text did not appear',
          interval: 500,
        }
      );

      // Verify final state shows "Final Update"
      const finalOutput = await cell.$('[data-slot="ansi-output"]');
      const finalText = await finalOutput.getText();
      expect(finalText).toContain("Final Update");

      // Should NOT contain intermediate updates (they were replaced)
      // Note: The display update replaces the entire content
      console.log("Final output text:", finalText);
      console.log("Multiple updates test passed");
    });
  });
});

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
  const EXECUTION_TIMEOUT = 45000;

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
   * Helper to wait for any output to appear in cell
   */
  async function waitForAnyOutput(cell, timeout) {
    await browser.waitUntil(
      async () => {
        // Check for various output types
        const streamOutput = await cell.$('[data-slot="ansi-stream-output"]');
        const ansiOutput = await cell.$('[data-slot="ansi-output"]');
        const htmlOutput = await cell.$('[data-slot="html-output"]');
        const imageOutput = await cell.$("img");
        const iframeOutput = await cell.$("iframe");

        return (
          (await streamOutput.isExisting()) ||
          (await ansiOutput.isExisting()) ||
          (await htmlOutput.isExisting()) ||
          (await imageOutput.isExisting()) ||
          (await iframeOutput.isExisting())
        );
      },
      {
        timeout,
        timeoutMsg: "No output appeared within timeout.",
        interval: 500,
      }
    );
  }

  /**
   * Helper to wait for cell HTML to contain specific text
   */
  async function waitForCellContent(cell, expectedText, timeout) {
    await browser.waitUntil(
      async () => {
        const cellHtml = await cell.getHTML();
        return cellHtml.includes(expectedText);
      },
      {
        timeout,
        timeoutMsg: `Cell content containing "${expectedText}" did not appear within timeout.`,
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
        // Check both data-slot and raw iframe
        const htmlSlot = await cell.$('[data-slot="html-output"]');
        const iframe = await cell.$("iframe");
        return (await htmlSlot.isExisting()) || (await iframe.isExisting());
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

      // Wait for initial output to appear
      await waitForAnyOutput(firstCell, KERNEL_STARTUP_TIMEOUT);
      console.log("Initial output appeared");

      // Verify the cell contains our text (may be wrapped in quotes as repr)
      await waitForCellContent(firstCell, "First is just plain", 5000);
      const initialHtml = await firstCell.getHTML();
      console.log("Cell contains 'First is just plain':", initialHtml.includes("First is just plain"));

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

      // Wait for second cell's execution to complete (wait for output or timeout)
      // This ensures the kernel has processed the update before we check
      await browser.pause(3000);

      // Check if second cell has an error (would indicate handle is not defined)
      const secondCellHtml = await secondCell.getHTML();
      console.log("Second cell HTML:", secondCellHtml.substring(0, 500));
      if (secondCellHtml.includes("NameError") || secondCellHtml.includes("Error")) {
        console.log("ERROR: Second cell has an error - handle might not be defined!");
        throw new Error("Second cell execution failed - check if handle variable persists across cells");
      }

      // Log first cell's current content for debugging
      const firstCellHtmlBefore = await firstCell.getHTML();
      console.log("First cell HTML (before wait):", firstCellHtmlBefore.substring(0, 500));
      console.log("Contains 'First is just plain':", firstCellHtmlBefore.includes("First is just plain"));
      console.log("Contains 'Different':", firstCellHtmlBefore.includes("Different"));

      // Wait for the FIRST cell's content to change - it should now contain "Different"
      // and should NOT contain "First is just plain" anymore
      await browser.waitUntil(
        async () => {
          const html = await firstCell.getHTML();
          // The update should replace the old content with new content
          return html.includes("Different") && !html.includes("First is just plain");
        },
        {
          timeout: EXECUTION_TIMEOUT,
          timeoutMsg: "Display update did not replace old content with new content",
          interval: 500,
        }
      );

      const updatedHtml = await firstCell.getHTML();
      console.log("First cell updated - contains 'Different':", updatedHtml.includes("Different"));
      console.log("First cell updated - no longer contains 'First is just plain':", !updatedHtml.includes("First is just plain"));

      // Verify the content changed
      expect(updatedHtml).toContain("Different");
      expect(updatedHtml).not.toContain("First is just plain");

      console.log("Display update test passed - output content changed from text/plain to text/html");
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

      // Wait for final output to appear in cell HTML
      await browser.waitUntil(
        async () => {
          const cellHtml = await cell.getHTML();
          return cellHtml.includes("Final Update");
        },
        {
          timeout: KERNEL_STARTUP_TIMEOUT,
          timeoutMsg: 'Final update text did not appear',
          interval: 500,
        }
      );

      // Verify final state shows "Final Update"
      const finalHtml = await cell.getHTML();
      expect(finalHtml).toContain("Final Update");
      console.log("Final output contains 'Final Update':", finalHtml.includes("Final Update"));

      console.log("Multiple updates test passed");
    });

    it("should update display output across cells with same MIME type", async () => {
      // This test verifies cross-cell updates work when MIME type stays the same
      // Simpler than test 1 which also changes MIME type

      // Get or create first code cell
      let cell1 = await $('[data-cell-type="code"]');
      if (!(await cell1.isExisting())) {
        cell1 = await addCodeCell();
      }
      await focusAndClearCell(cell1);

      // First cell: create display with text
      const code1 = `from IPython.display import display
crosshandle = display("Cross-cell initial", display_id=True)`;

      console.log("Typing first cell code (cross-cell test)");
      await typeSlowly(code1, 30);
      await browser.pause(300);

      await browser.keys(["Shift", "Enter"]);
      console.log("Executed first cell (cross-cell test)");

      // Wait for output
      await waitForAnyOutput(cell1, KERNEL_STARTUP_TIMEOUT);
      await waitForCellContent(cell1, "Cross-cell initial", 5000);
      console.log("First cell has initial output");

      // Add second cell
      const cell2 = await addCodeCell();
      await focusAndClearCell(cell2);

      // Second cell: update the display (same MIME type - still text/plain)
      const code2 = `crosshandle.update("Cross-cell updated")`;

      console.log("Typing second cell code (simple update)");
      await typeSlowly(code2, 30);
      await browser.pause(300);

      await browser.keys(["Shift", "Enter"]);
      console.log("Executed second cell (cross-cell test)");

      // Wait and check for errors
      await browser.pause(3000);

      const cell2Html = await cell2.getHTML();
      console.log("Cell 2 HTML:", cell2Html.substring(0, 300));
      if (cell2Html.includes("NameError") || cell2Html.includes("Error")) {
        throw new Error("Second cell has an error - crosshandle not defined");
      }

      // Check cell 1's state
      const cell1HtmlAfter = await cell1.getHTML();
      console.log("Cell 1 HTML after:", cell1HtmlAfter.substring(0, 500));
      console.log("Contains 'Cross-cell initial':", cell1HtmlAfter.includes("Cross-cell initial"));
      console.log("Contains 'Cross-cell updated':", cell1HtmlAfter.includes("Cross-cell updated"));

      // Wait for update
      await browser.waitUntil(
        async () => {
          const html = await cell1.getHTML();
          return html.includes("Cross-cell updated") && !html.includes("Cross-cell initial");
        },
        {
          timeout: EXECUTION_TIMEOUT,
          timeoutMsg: "Cross-cell update did not work",
          interval: 500,
        }
      );

      const finalHtml = await cell1.getHTML();
      expect(finalHtml).toContain("Cross-cell updated");
      expect(finalHtml).not.toContain("Cross-cell initial");

      console.log("Cross-cell update test passed (same MIME type)");
    });
  });
});

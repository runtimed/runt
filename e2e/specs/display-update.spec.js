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
import os from "node:os";

// macOS uses Cmd (Meta) for shortcuts, Linux uses Ctrl
const MOD_KEY = os.platform() === "darwin" ? "Meta" : "Control";

describe("Display Updates", () => {
  const KERNEL_STARTUP_TIMEOUT = 90000;

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
   * Helper to focus and clear a cell's editor
   */
  async function focusAndClearCell(cell) {
    const editor = await cell.$('.cm-content[contenteditable="true"]');
    await editor.waitForExist({ timeout: 5000 });
    await editor.click();
    await browser.pause(200);

    // Clear any existing content
    await browser.keys([MOD_KEY, "a"]);
    await browser.pause(100);
  }

  describe("update_display_data message handling", () => {
    it("should update display output while preserving display_id", async () => {
      // This test verifies multiple updates work correctly within a single cell execution

      // Get or create a code cell
      const cell = await $('[data-cell-type="code"]');
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
  });
});

/**
 * E2E Test: Keyboard Navigation Between Cells
 *
 * Tests ArrowUp/ArrowDown navigation between cells:
 * - ArrowDown at end of content moves focus to the next cell (cursor at start)
 * - ArrowUp at position 0 moves focus to the previous cell (cursor at end)
 * - Arrow keys in the middle of content do NOT cross cell boundaries
 *
 * Focus detection: Types a unique marker character after navigation and checks
 * which cell's editor contains it. This works reliably in wry where
 * .cm-focused CSS class may not update.
 */

import { browser, expect } from "@wdio/globals";
import os from "node:os";
import { waitForAppReady, typeSlowly } from "../helpers.js";

const MOD_KEY = os.platform() === "darwin" ? "Meta" : "Control";

/**
 * Get the text content of a cell's CodeMirror editor by index.
 */
async function getCellEditorText(cellIndex) {
  return await browser.execute((idx) => {
    const cells = document.querySelectorAll('[data-cell-type="code"]');
    const cell = cells[idx];
    if (!cell) return null;
    const cmContent = cell.querySelector(".cm-content");
    return cmContent ? cmContent.textContent : null;
  }, cellIndex);
}

describe("Keyboard Navigation", () => {
  let cell1Index;
  let cell2Index;

  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());

    // Count existing cells so we know our offset
    const existingCells = await $$('[data-cell-type="code"]');
    const offset = existingCells.length;

    // Add 2 fresh code cells at the end
    const addCodeButton = await $('[data-testid="add-code-cell-button"]');
    await addCodeButton.click();
    await browser.pause(300);
    await addCodeButton.click();
    await browser.pause(300);

    cell1Index = offset;
    cell2Index = offset + 1;

    // Type known content in cell 1
    const cells1 = await $$('[data-cell-type="code"]');
    const editor1 = await cells1[cell1Index].$('.cm-content[contenteditable="true"]');
    await editor1.waitForExist({ timeout: 5000 });
    await editor1.click();
    await browser.pause(200);
    await browser.keys([MOD_KEY, "a"]);
    await browser.pause(100);
    await typeSlowly("AAA");
    await browser.pause(200);

    // Type known content in cell 2
    const cells2 = await $$('[data-cell-type="code"]');
    const editor2 = await cells2[cell2Index].$('.cm-content[contenteditable="true"]');
    await editor2.waitForExist({ timeout: 5000 });
    await editor2.click();
    await browser.pause(200);
    await browser.keys([MOD_KEY, "a"]);
    await browser.pause(100);
    await typeSlowly("BBB");
    await browser.pause(200);

    const text1 = await getCellEditorText(cell1Index);
    const text2 = await getCellEditorText(cell2Index);
    console.log("Cell 1 text:", JSON.stringify(text1), "Cell 2 text:", JSON.stringify(text2));
  });

  it("should navigate down from cell 1 to cell 2 with ArrowDown at end", async () => {
    // Focus cell 1, move cursor to end
    const cells = await $$('[data-cell-type="code"]');
    const editor1 = await cells[cell1Index].$('.cm-content[contenteditable="true"]');
    await editor1.click();
    await browser.pause(200);
    await browser.keys([MOD_KEY, "a"]);
    await browser.pause(100);
    await browser.keys(["ArrowRight"]); // deselect, cursor at end
    await browser.pause(200);

    // Press ArrowDown — should move focus to cell 2
    await browser.keys(["ArrowDown"]);
    await browser.pause(300);

    // Type a marker to verify which cell has focus
    await typeSlowly("X");
    await browser.pause(200);

    // Cell 2 should now contain the marker
    const text2 = await getCellEditorText(cell2Index);
    const text1 = await getCellEditorText(cell1Index);
    console.log("After ArrowDown+X: cell1:", JSON.stringify(text1), "cell2:", JSON.stringify(text2));
    expect(text2).toContain("X");
    expect(text1).not.toContain("X");

    // Clean up: remove the marker from cell 2
    await browser.keys(["Backspace"]);
    await browser.pause(100);
  });

  it("should navigate up from cell 2 to cell 1 with ArrowUp at start", async () => {
    // Focus cell 2, move cursor to start
    const cells = await $$('[data-cell-type="code"]');
    const editor2 = await cells[cell2Index].$('.cm-content[contenteditable="true"]');
    await editor2.click();
    await browser.pause(200);
    await browser.keys([MOD_KEY, "a"]);
    await browser.pause(100);
    await browser.keys(["ArrowLeft"]); // deselect, cursor at start (position 0)
    await browser.pause(200);

    // Press ArrowUp — should move focus to cell 1
    await browser.keys(["ArrowUp"]);
    await browser.pause(300);

    // Type a marker to verify which cell has focus
    await typeSlowly("Y");
    await browser.pause(200);

    // Cell 1 should now contain the marker
    const text1 = await getCellEditorText(cell1Index);
    const text2 = await getCellEditorText(cell2Index);
    console.log("After ArrowUp+Y: cell1:", JSON.stringify(text1), "cell2:", JSON.stringify(text2));
    expect(text1).toContain("Y");
    expect(text2).not.toContain("Y");

    // Clean up: remove the marker from cell 1
    await browser.keys(["Backspace"]);
    await browser.pause(100);
  });

  it("should NOT navigate when cursor is in the middle of content", async () => {
    // Focus cell 1, move cursor to middle (between first and second char)
    const cells = await $$('[data-cell-type="code"]');
    const editor1 = await cells[cell1Index].$('.cm-content[contenteditable="true"]');
    await editor1.click();
    await browser.pause(200);
    await browser.keys([MOD_KEY, "a"]);
    await browser.pause(100);
    await browser.keys(["ArrowLeft"]); // cursor at start
    await browser.pause(100);
    await browser.keys(["ArrowRight"]); // cursor at position 1 (middle)
    await browser.pause(200);

    // Press ArrowDown — should NOT move focus (cursor not at end)
    await browser.keys(["ArrowDown"]);
    await browser.pause(300);

    // Type a marker — should go into cell 1 (focus stayed)
    await typeSlowly("Z");
    await browser.pause(200);

    const text1 = await getCellEditorText(cell1Index);
    const text2 = await getCellEditorText(cell2Index);
    console.log("After mid-content ArrowDown+Z: cell1:", JSON.stringify(text1), "cell2:", JSON.stringify(text2));
    expect(text1).toContain("Z");
    expect(text2).not.toContain("Z");

    // Clean up
    await browser.keys(["Backspace"]);
    await browser.pause(100);
  });
});

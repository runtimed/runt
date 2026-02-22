/**
 * E2E Test: Alt+Enter (Execute and Insert Cell)
 *
 * Tests that Alt+Enter in a code cell:
 * 1. Executes the current cell
 * 2. Inserts a new empty code cell below
 */

import { browser, expect } from "@wdio/globals";
import { setupCodeCell, typeSlowly, waitForAppReady } from "../helpers.js";

describe("Alt+Enter Execute and Insert", () => {
  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());
  });

  it("should execute cell and insert new cell below on Alt+Enter", async () => {
    // Setup: get or create a code cell, clear its content
    const codeCell = await setupCodeCell();

    // Type code that produces output
    await typeSlowly('print("alt-enter-test")');
    await browser.pause(300);

    // Count cells before
    const cellsBefore = await $$('[data-cell-type="code"]');
    const countBefore = cellsBefore.length;
    console.log("Cells before Alt+Enter:", countBefore);

    // Press Alt+Enter
    await browser.keys(["Alt", "Enter"]);

    // Wait for the new cell to be created
    await browser.waitUntil(
      async () => {
        const cells = await $$('[data-cell-type="code"]');
        return cells.length === countBefore + 1;
      },
      {
        timeout: 5000,
        interval: 200,
        timeoutMsg: "New cell was not inserted after Alt+Enter",
      },
    );

    const cellsAfter = await $$('[data-cell-type="code"]');
    console.log("Cells after Alt+Enter:", cellsAfter.length);
    expect(cellsAfter.length).toBe(countBefore + 1);

    // Wait for execution output in the original cell (includes kernel startup time)
    await browser.waitUntil(
      async () => {
        const output = await codeCell.$('[data-slot="ansi-stream-output"]');
        if (!(await output.isExisting())) return false;
        const text = await output.getText();
        return text.includes("alt-enter-test");
      },
      {
        timeout: 90000,
        interval: 500,
        timeoutMsg: "Cell did not produce output after Alt+Enter execution",
      },
    );

    const outputText = await codeCell
      .$('[data-slot="ansi-stream-output"]')
      .getText();
    console.log("Output:", outputText);
    expect(outputText).toContain("alt-enter-test");

    console.log("Alt+Enter: executed cell and inserted new cell");
  });
});

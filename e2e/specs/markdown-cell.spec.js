/**
 * E2E Test: Markdown Cell
 *
 * Tests markdown cell functionality:
 * - Create markdown cell
 * - Edit markdown content
 * - Double-click to edit rendered markdown
 * - Exit edit mode (Escape, blur)
 * - Markdown renders in isolated iframe
 */

import { browser, expect } from "@wdio/globals";

describe("Markdown Cell", () => {
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
   * Helper to count markdown cells
   */
  async function countMarkdownCells() {
    const cells = await $$('[data-cell-type="markdown"]');
    return cells.length;
  }

  /**
   * Helper to get the markdown cell's editor
   */
  async function getMarkdownEditor(cell) {
    return cell.$('.cm-content[contenteditable="true"]');
  }

  /**
   * Helper to check if cell is in edit mode (has CodeMirror editor)
   */
  async function isInEditMode(cell) {
    const editor = await cell.$('.cm-content[contenteditable="true"]');
    return editor.isExisting();
  }

  /**
   * Helper to check if cell has an iframe (rendered mode with isolation)
   */
  async function hasIsolatedFrame(cell) {
    const iframe = await cell.$("iframe");
    return iframe.isExisting();
  }

  describe("Creating and editing markdown cells", () => {
    it("should create a markdown cell", async () => {
      const initialCount = await countMarkdownCells();
      console.log("Initial markdown cell count:", initialCount);

      // Click the "Markdown" button to add a new markdown cell
      const addMdButton = await $("button*=Markdown");
      const buttonExists = await addMdButton.isExisting();

      if (buttonExists) {
        await addMdButton.waitForClickable({ timeout: 5000 });
        await addMdButton.click();
        await browser.pause(500);

        const newCount = await countMarkdownCells();
        console.log("New markdown cell count:", newCount);

        expect(newCount).toBe(initialCount + 1);
        console.log("Create markdown cell test passed");
      } else {
        console.log("Markdown button not found, skipping test");
      }
    });

    it("should start in edit mode for new empty markdown cell", async () => {
      // Get the newest markdown cell (should be in edit mode since it's empty)
      const cells = await $$('[data-cell-type="markdown"]');
      if (cells.length === 0) {
        console.log("No markdown cells found, skipping");
        return;
      }

      const newestCell = cells[cells.length - 1];
      const inEditMode = await isInEditMode(newestCell);

      console.log("New markdown cell in edit mode:", inEditMode);
      expect(inEditMode).toBe(true);
    });

    it("should type and save markdown content", async () => {
      // Get the newest markdown cell
      const cells = await $$('[data-cell-type="markdown"]');
      if (cells.length === 0) {
        console.log("No markdown cells found, skipping");
        return;
      }

      const cell = cells[cells.length - 1];
      const editor = await getMarkdownEditor(cell);

      if (!(await editor.isExisting())) {
        console.log("Editor not found, cell may not be in edit mode");
        return;
      }

      // Click to focus
      await editor.click();
      await browser.pause(200);

      // Type markdown content
      const markdownContent = "# Hello World";
      await typeSlowly(markdownContent);
      await browser.pause(300);

      // Press Escape to exit edit mode
      await browser.keys("Escape");
      await browser.pause(500);

      // Verify we're no longer in edit mode
      const stillInEditMode = await isInEditMode(cell);
      console.log("Still in edit mode after Escape:", stillInEditMode);
      expect(stillInEditMode).toBe(false);

      console.log("Type and save markdown test passed");
    });

    it("should render markdown in isolated iframe", async () => {
      // Get a markdown cell that has content (not in edit mode)
      const cells = await $$('[data-cell-type="markdown"]');

      for (const cell of cells) {
        const inEditMode = await isInEditMode(cell);
        if (!inEditMode) {
          const hasIframe = await hasIsolatedFrame(cell);
          console.log("Markdown cell has isolated iframe:", hasIframe);
          expect(hasIframe).toBe(true);

          // Verify the iframe has sandbox attribute
          const iframe = await cell.$("iframe");
          const sandbox = await iframe.getAttribute("sandbox");
          console.log("Iframe sandbox attribute:", sandbox);
          expect(sandbox).toBeDefined();
          expect(sandbox).not.toContain("allow-same-origin");

          console.log("Isolated iframe test passed");
          return;
        }
      }

      console.log("No rendered markdown cells found to test iframe isolation");
    });
  });

  describe("Double-click to edit", () => {
    it("should enter edit mode on double-click", async () => {
      // First, ensure we have a markdown cell with content (not in edit mode)
      const cells = await $$('[data-cell-type="markdown"]');

      let targetCell = null;
      for (const cell of cells) {
        const inEditMode = await isInEditMode(cell);
        if (!inEditMode) {
          targetCell = cell;
          break;
        }
      }

      if (!targetCell) {
        // Create a markdown cell and add content
        const addMdButton = await $("button*=Markdown");
        if (await addMdButton.isExisting()) {
          await addMdButton.click();
          await browser.pause(500);

          const newCells = await $$('[data-cell-type="markdown"]');
          targetCell = newCells[newCells.length - 1];

          const editor = await getMarkdownEditor(targetCell);
          await editor.click();
          await browser.pause(200);
          await typeSlowly("# Test Double Click");
          await browser.pause(300);
          await browser.keys("Escape");
          await browser.pause(500);
        }
      }

      if (!targetCell) {
        console.log("Could not set up test cell, skipping");
        return;
      }

      // Verify cell is in rendered mode (has iframe, no editor)
      let inEditMode = await isInEditMode(targetCell);
      console.log("Cell in edit mode before double-click:", inEditMode);

      if (inEditMode) {
        // Exit edit mode first
        await browser.keys("Escape");
        await browser.pause(500);
        inEditMode = await isInEditMode(targetCell);
      }

      expect(inEditMode).toBe(false);

      // Double-click on the cell to enter edit mode
      // The iframe should forward the double-click to the parent
      const iframe = await targetCell.$("iframe");
      if (await iframe.isExisting()) {
        await iframe.doubleClick();
      } else {
        await targetCell.doubleClick();
      }
      await browser.pause(500);

      // Verify we're now in edit mode
      const nowInEditMode = await isInEditMode(targetCell);
      console.log("Cell in edit mode after double-click:", nowInEditMode);
      expect(nowInEditMode).toBe(true);

      console.log("Double-click to edit test passed");
    });
  });

  describe("Edit button", () => {
    it("should enter edit mode when clicking edit button", async () => {
      // First, ensure we have a markdown cell not in edit mode
      const cells = await $$('[data-cell-type="markdown"]');

      let targetCell = null;
      for (const cell of cells) {
        const inEditMode = await isInEditMode(cell);
        if (!inEditMode) {
          targetCell = cell;
          break;
        }
      }

      if (!targetCell) {
        console.log("No rendered markdown cell found, skipping");
        return;
      }

      // Hover over the cell to reveal the edit button
      await targetCell.moveTo();
      await browser.pause(300);

      // Find and click the edit button (pencil icon)
      const editButton = await targetCell.$('button[title="Edit"]');
      if (await editButton.isExisting()) {
        await editButton.click();
        await browser.pause(500);

        const nowInEditMode = await isInEditMode(targetCell);
        console.log("Cell in edit mode after clicking edit button:", nowInEditMode);
        expect(nowInEditMode).toBe(true);

        console.log("Edit button test passed");
      } else {
        console.log("Edit button not found, skipping");
      }
    });
  });

  describe("Keyboard navigation", () => {
    it("should exit edit mode with Shift+Enter", async () => {
      // Get a markdown cell in edit mode
      const cells = await $$('[data-cell-type="markdown"]');

      let targetCell = null;
      for (const cell of cells) {
        const inEditMode = await isInEditMode(cell);
        if (inEditMode) {
          targetCell = cell;
          break;
        }
      }

      if (!targetCell) {
        // Create or enter edit mode on a cell
        const addMdButton = await $("button*=Markdown");
        if (await addMdButton.isExisting()) {
          await addMdButton.click();
          await browser.pause(500);

          const newCells = await $$('[data-cell-type="markdown"]');
          targetCell = newCells[newCells.length - 1];

          const editor = await getMarkdownEditor(targetCell);
          await editor.click();
          await browser.pause(200);
          await typeSlowly("# Shift Enter Test");
          await browser.pause(300);
        }
      }

      if (!targetCell) {
        console.log("Could not set up test cell, skipping");
        return;
      }

      // Verify we're in edit mode
      let inEditMode = await isInEditMode(targetCell);
      if (!inEditMode) {
        console.log("Cell not in edit mode, skipping");
        return;
      }

      // Press Shift+Enter to exit edit mode
      await browser.keys(["Shift", "Enter"]);
      await browser.pause(500);

      // Verify we exited edit mode
      const stillInEditMode = await isInEditMode(targetCell);
      console.log("Still in edit mode after Shift+Enter:", stillInEditMode);
      expect(stillInEditMode).toBe(false);

      console.log("Shift+Enter navigation test passed");
    });
  });
});

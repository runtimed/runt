/**
 * E2E Test: UV Inline Dependencies
 *
 * Verifies that notebooks with inline UV dependencies get a cached
 * environment with those deps installed (not the prewarmed pool).
 *
 * Fixture: 2-uv-inline.ipynb (has requests dependency)
 */

import { browser } from "@wdio/globals";
import {
  approveTrustDialog,
  executeFirstCell,
  typeSlowly,
  waitForCellOutput,
  waitForKernelReady,
} from "../helpers.js";

describe("UV Inline Dependencies", () => {
  it("should auto-launch kernel (may need trust approval)", async () => {
    // Wait for kernel or trust dialog (90s for first startup + env creation)
    await waitForKernelReady(120000);
  });

  it("should have inline deps available after trust", async () => {
    // Execute the first cell (prints sys.executable)
    const cell = await executeFirstCell();

    // May need to approve trust dialog for inline deps
    const approved = await approveTrustDialog(15000);
    if (approved) {
      // If trust dialog appeared, wait for kernel to restart with deps
      await waitForKernelReady(120000);
      // Re-execute after kernel restart
      await browser.keys(["Shift", "Enter"]);
    }

    // Wait for output
    const output = await waitForCellOutput(cell, 60000);

    // Should be a cached inline env (inline-* path)
    expect(output).toContain("inline-");
  });

  it("should be able to import inline dependency", async () => {
    // Find a cell and type import test
    const cells = await $$('[data-cell-type="code"]');
    const cell = cells.length > 1 ? cells[1] : cells[0];

    const editor = await cell.$('.cm-content[contenteditable="true"]');
    await editor.click();
    await browser.pause(200);

    // Select all and type import
    const modKey = process.platform === "darwin" ? "Meta" : "Control";
    await browser.keys([modKey, "a"]);
    await browser.pause(100);

    await typeSlowly("import requests; print(requests.__version__)");
    await browser.keys(["Shift", "Enter"]);

    // Wait for version output
    const output = await waitForCellOutput(cell, 30000);
    // Should show a version number (e.g., "2.31.0")
    expect(output).toMatch(/^\d+\.\d+/);
  });
});

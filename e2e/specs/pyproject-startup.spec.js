/**
 * E2E Test: pyproject.toml kernel startup (Fixture #5)
 *
 * Opens a notebook next to pyproject.toml.
 * Verifies that the kernel starts without hanging (the "beach-ball" bug),
 * even when uv needs to create .venv and install dependencies.
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/pyproject-project/5-pyproject.ipynb
 */

import { browser, expect } from "@wdio/globals";
import {
  waitForAppReady,
  executeFirstCell,
  waitForCellOutput,
} from "../helpers.js";

describe("Pyproject Kernel Startup", () => {
  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());
  });

  it("should start kernel with pyproject.toml without hanging", async () => {
    const codeCell = await executeFirstCell();
    console.log("Triggered execution (uv run kernel start)");

    // 3 min timeout: uv may need to install deps
    const outputText = await waitForCellOutput(codeCell, 180000);
    console.log("Python executable:", outputText);

    // The python executable should exist (any valid path)
    expect(outputText.length).toBeGreaterThan(0);
    console.log("Pyproject startup test passed: kernel started without hanging");
  });

  it("should show pyproject.toml in toolbar env source", async () => {
    const toolbar = await $('[data-testid="notebook-toolbar"]');
    if (await toolbar.isExisting()) {
      const toolbarText = await toolbar.getText();
      console.log("Toolbar text:", toolbarText);
      expect(toolbarText.toLowerCase()).toContain("pyproject");
    }
  });
});

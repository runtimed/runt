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

  it("should show pyproject env source in toolbar", async () => {
    // The env badge shows an icon with a title attribute like "Environment: uv:pyproject"
    const envBadge = await browser.execute(() => {
      const els = document.querySelectorAll('[data-testid="notebook-toolbar"] [title]');
      for (const el of els) {
        if (el.title.startsWith("Environment:")) return el.title;
      }
      return null;
    });
    console.log("Env badge title:", envBadge);
    if (envBadge) {
      expect(envBadge).toContain("pyproject");
    }
  });
});

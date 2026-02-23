/**
 * E2E Test: Error Handling (Fixture)
 *
 * Opens a notebook with pre-populated error outputs (12-error-outputs.ipynb) and
 * verifies that error tracebacks render correctly without needing a kernel.
 *
 * Tests: SyntaxError, ZeroDivisionError, ModuleNotFoundError, NameError, TypeError.
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/12-error-outputs.ipynb
 */

import { browser, expect } from "@wdio/globals";
import { waitForAppReady } from "../helpers.js";

describe("Error Handling", () => {
  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());
  });

  async function getCodeCells() {
    return await $$('[data-cell-type="code"]');
  }

  async function getErrorText(cell) {
    const errorOutput = await cell.$('[data-slot="ansi-error-output"]');
    await errorOutput.waitForExist({ timeout: 10000 });
    return await errorOutput.getText();
  }

  it("should display syntax error traceback", async () => {
    const cells = await getCodeCells();
    const errorText = await getErrorText(cells[0]);
    console.log("Error output:", errorText);

    expect(
      errorText.includes("SyntaxError") || errorText.includes("syntax"),
    ).toBe(true);
    console.log("Syntax error test passed");
  });

  it("should display ZeroDivisionError", async () => {
    const cells = await getCodeCells();
    const errorText = await getErrorText(cells[1]);
    console.log("Error output:", errorText);

    expect(errorText).toContain("ZeroDivisionError");
    console.log("ZeroDivisionError test passed");
  });

  it("should display ImportError for missing packages", async () => {
    const cells = await getCodeCells();
    const errorText = await getErrorText(cells[2]);
    console.log("Error output:", errorText);

    expect(
      errorText.includes("ModuleNotFoundError") ||
        errorText.includes("ImportError"),
    ).toBe(true);
    console.log("ImportError test passed");
  });

  it("should display NameError for undefined variables", async () => {
    const cells = await getCodeCells();
    const errorText = await getErrorText(cells[3]);
    console.log("Error output:", errorText);

    expect(errorText).toContain("NameError");
    console.log("NameError test passed");
  });

  it("should display TypeError for invalid operations", async () => {
    const cells = await getCodeCells();
    const errorText = await getErrorText(cells[4]);
    console.log("Error output:", errorText);

    expect(errorText).toContain("TypeError");
    console.log("TypeError test passed");
  });
});

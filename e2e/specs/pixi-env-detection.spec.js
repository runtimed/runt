/**
 * E2E Test: Pixi environment detection (Fixture #6)
 *
 * Opens a notebook next to pixi.toml.
 * Verifies that the backend auto-detects pixi.toml and launches a
 * conda kernel (not UV).
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/pixi-project/6-pixi.ipynb
 */

import { browser, expect } from "@wdio/globals";
import {
  executeFirstCell,
  waitForAppReady,
  waitForCellOutput,
} from "../helpers.js";

describe("Pixi Environment Detection", () => {
  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());
  });

  it("should detect pixi.toml and start a conda kernel", async () => {
    const codeCell = await executeFirstCell();
    console.log("Triggered execution");

    const outputText = await waitForCellOutput(codeCell, 120000);
    console.log("Python executable:", outputText);

    // Pixi auto-detection should launch a conda kernel
    expect(outputText).toContain("runt/conda-envs");
    console.log("Pixi test passed: kernel is from conda env");
  });
});

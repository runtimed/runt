/**
 * E2E Test: environment.yml detection (Fixture #7)
 *
 * Opens a notebook next to environment.yml.
 * Verifies that the backend auto-detects the environment file and
 * launches a conda kernel.
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/conda-env-project/7-environment-yml.ipynb
 */

import { browser, expect } from "@wdio/globals";
import {
  executeFirstCell,
  waitForAppReady,
  waitForCellOutput,
  waitForKernelReady,
} from "../helpers.js";

describe("Environment.yml Detection", () => {
  before(async () => {
    await waitForAppReady();
    await waitForKernelReady(90000); // conda env may need time to create
    console.log("Page title:", await browser.getTitle());
  });

  it("should detect environment.yml and start a conda kernel", async () => {
    const codeCell = await executeFirstCell();
    console.log("Triggered execution");

    const outputText = await waitForCellOutput(codeCell, 120000);
    console.log("Python executable:", outputText);

    // environment.yml detection should launch a conda kernel
    expect(outputText).toContain("runt/conda-envs");
  });
});

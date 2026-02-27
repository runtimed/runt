/**
 * E2E Test: Conda inline dependencies (Fixture #3)
 *
 * Opens a notebook with conda inline dependencies (numpy).
 * Verifies the trust dialog appears, approves it, and checks
 * that the kernel starts from a conda environment.
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/3-conda-inline.ipynb
 */

import { browser, expect } from "@wdio/globals";
import {
  approveTrustDialog,
  executeFirstCell,
  isCondaManagedEnv,
  waitForAppReady,
  waitForCellOutput,
} from "../helpers.js";

describe("Conda Inline Dependencies", () => {
  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());
  });

  it("should show trust dialog and start conda kernel after approval", async () => {
    const codeCell = await executeFirstCell();
    console.log("Triggered execution — expecting trust dialog");

    await approveTrustDialog();
    console.log("Trust dialog approved");

    const outputText = await waitForCellOutput(codeCell, 120000);
    console.log("Python executable:", outputText);

    // Should be a conda-managed environment
    expect(isCondaManagedEnv(outputText)).toBe(true);
  });
});

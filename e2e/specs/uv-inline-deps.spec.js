/**
 * E2E Test: UV inline dependencies (Fixture #2)
 *
 * Opens a notebook with uv inline dependencies (requests).
 * Verifies the trust dialog appears, approves it, and checks
 * that the kernel starts from a UV environment.
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/2-uv-inline.ipynb
 */

import { browser, expect } from "@wdio/globals";
import {
  approveTrustDialog,
  executeFirstCell,
  waitForAppReady,
  waitForCellOutput,
} from "../helpers.js";

describe("UV Inline Dependencies", () => {
  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());
  });

  it("should show trust dialog and start UV kernel after approval", async () => {
    const codeCell = await executeFirstCell();
    console.log("Triggered execution — expecting trust dialog");

    await approveTrustDialog();
    console.log("Trust dialog approved");

    const outputText = await waitForCellOutput(codeCell, 120000);
    console.log("Python executable:", outputText);

    // Should be a UV-managed environment
    expect(outputText).toContain("runt/envs");
  });
});

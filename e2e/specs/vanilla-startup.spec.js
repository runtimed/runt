/**
 * E2E Test: Vanilla notebook startup (Fixture #1)
 *
 * Opens a notebook with no dependencies.
 * Verifies that the kernel starts with a prewarmed environment.
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/1-vanilla.ipynb
 */

import { browser, expect } from "@wdio/globals";
import {
  executeFirstCell,
  isManagedEnv,
  waitForAppReady,
  waitForCellOutput,
  waitForKernelReady,
} from "../helpers.js";

describe("Vanilla Notebook Startup", () => {
  before(async () => {
    await waitForAppReady();
    await waitForKernelReady();
    console.log("Page title:", await browser.getTitle());
  });

  it("should start kernel with a prewarmed environment", async () => {
    const codeCell = await executeFirstCell();
    console.log("Triggered execution");

    const outputText = await waitForCellOutput(codeCell, 60000);
    console.log("Python executable:", outputText);

    // Should be a managed environment (UV/conda prewarmed or daemon worktree env)
    expect(isManagedEnv(outputText)).toBe(true);
  });
});

/**
 * E2E Test: Both-deps panel (Fixture #4)
 *
 * Opens a notebook with both uv and conda dependencies.
 * Verifies that the trust dialog appears (since there are inline deps),
 * approves it, and checks that the kernel starts with a managed environment.
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/4-both-deps.ipynb
 */

import { browser, expect } from "@wdio/globals";
import {
  approveTrustDialog,
  executeFirstCell,
  isCondaManagedEnv,
  isManagedEnv,
  isUvManagedEnv,
  waitForAppReady,
  waitForCellOutput,
} from "../helpers.js";

describe("Both Dependencies Panel", () => {
  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());
  });

  it("should show trust dialog and start kernel after approval", async () => {
    const codeCell = await executeFirstCell();
    console.log("Triggered execution — expecting trust dialog");

    await approveTrustDialog();
    console.log("Trust dialog approved");

    const outputText = await waitForCellOutput(codeCell, 120000);
    console.log("Python executable:", outputText);

    // Check which env backend was used
    const isCondaEnv = isCondaManagedEnv(outputText);
    const isUvEnv = isUvManagedEnv(outputText);
    console.log(
      `Backend chose: ${isCondaEnv ? "conda" : isUvEnv ? "uv" : "unknown"}`,
    );

    // The key assertion: kernel started with *some* managed environment
    expect(isManagedEnv(outputText)).toBe(true);
  });
});

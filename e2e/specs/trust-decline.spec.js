/**
 * E2E Test: Trust dialog decline flow (Fixture)
 *
 * Opens a notebook with UV inline deps (2-uv-inline.ipynb).
 * Verifies that clicking "Don't Install" prevents the kernel from starting
 * and keeps the notebook in a safe state.
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/2-uv-inline.ipynb
 */

import { browser, expect } from "@wdio/globals";
import {
  waitForAppReady,
  executeFirstCell,
  getKernelStatus,
} from "../helpers.js";

describe("Trust Dialog Decline", () => {
  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());
  });

  it("should show trust dialog when executing untrusted notebook", async () => {
    await executeFirstCell();
    console.log("Triggered execution — expecting trust dialog");

    const dialog = await $('[data-testid="trust-dialog"]');
    await dialog.waitForExist({ timeout: 15000 });

    // Verify dialog shows package review UI
    const dialogText = await dialog.getText();
    console.log("Trust dialog text:", dialogText);
    expect(dialogText).toContain("PyPI Packages");
  });

  it("should not start kernel after clicking Don't Install", async () => {
    const declineButton = await $('[data-testid="trust-decline-button"]');
    await declineButton.waitForClickable({ timeout: 5000 });
    await declineButton.click();
    console.log("Clicked Don't Install");

    // Wait for dialog to close
    const dialog = await $('[data-testid="trust-dialog"]');
    await browser.waitUntil(
      async () => !(await dialog.isExisting()),
      { timeout: 10000, interval: 300, timeoutMsg: "Trust dialog did not close" }
    );

    // Give it a moment, then verify kernel did NOT start
    await browser.pause(2000);

    const status = await getKernelStatus();
    console.log("Kernel status after decline:", status);
    expect(status).toBe("not started");
  });

  it("should not produce any cell output", async () => {
    // The cell should have no output since kernel never started
    const codeCell = await $('[data-cell-type="code"]');
    const streamOutput = await codeCell.$('[data-slot="ansi-stream-output"]');
    const errorOutput = await codeCell.$('[data-slot="ansi-error-output"]');

    const hasStream = await streamOutput.isExisting();
    const hasError = await errorOutput.isExisting();

    console.log("Has stream output:", hasStream, "Has error output:", hasError);
    expect(hasStream).toBe(false);
    expect(hasError).toBe(false);
  });
});

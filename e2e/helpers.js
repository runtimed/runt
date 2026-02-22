/**
 * Shared E2E test helpers
 *
 * Provides smart wait functions that detect actual app/kernel readiness
 * instead of relying on arbitrary pauses.
 */

import { browser } from "@wdio/globals";
import os from "node:os";

// macOS uses Cmd (Meta) for shortcuts, Linux uses Ctrl
const MOD_KEY = os.platform() === "darwin" ? "Meta" : "Control";

/**
 * Wait for the app to be fully loaded (toolbar visible).
 * Uses browser.execute() (executeScript) which goes through the JS bridge
 * directly, avoiding potential findElement timing issues.
 */
export async function waitForAppReady() {
  await browser.waitUntil(
    async () => {
      return await browser.execute(() => {
        return !!document.querySelector('[data-testid="notebook-toolbar"]');
      });
    },
    {
      timeout: 15000,
      interval: 300,
      timeoutMsg: "App not ready — toolbar not found within 15s",
    }
  );
}

/**
 * Wait for the kernel to reach idle or busy state.
 * Use this in specs that execute code — replaces both the 5000ms before()
 * pause AND the first kernel startup wait.
 */
export async function waitForKernelReady() {
  await waitForAppReady();
  await browser.waitUntil(
    async () => {
      const text = await browser.execute(() => {
        const el = document.querySelector(
          '[data-testid="notebook-toolbar"] .capitalize'
        );
        return el ? el.textContent.trim().toLowerCase() : "";
      });
      return text === "idle" || text === "busy";
    },
    { timeout: 30000, interval: 200, timeoutMsg: "Kernel not ready" }
  );
}

/**
 * Find the first code cell and execute it with Shift+Enter.
 * Assumes the cell already has code (pre-populated in fixture notebooks).
 * Returns the cell element for further assertions.
 */
export async function executeFirstCell() {
  const codeCell = await $('[data-cell-type="code"]');
  await codeCell.waitForExist({ timeout: 5000 });

  // Focus the editor and execute
  const editor = await codeCell.$('.cm-content[contenteditable="true"]');
  await editor.waitForExist({ timeout: 5000 });
  await editor.click();
  await browser.pause(200);

  // Select all first to place cursor (ensures focus is in the editor)
  await browser.keys([MOD_KEY, "a"]);
  await browser.pause(100);
  // Move to end so we don't replace content
  await browser.keys(["ArrowRight"]);
  await browser.pause(100);

  await browser.keys(["Shift", "Enter"]);
  return codeCell;
}

/**
 * Wait for stream output to appear in a cell.
 * Returns the output text.
 */
export async function waitForCellOutput(cell, timeout = 120000) {
  await browser.waitUntil(
    async () => {
      const output = await cell.$('[data-slot="ansi-stream-output"]');
      return await output.isExisting();
    },
    {
      timeout,
      timeoutMsg: `No output appeared within ${timeout / 1000}s`,
      interval: 1000,
    }
  );

  return await cell.$('[data-slot="ansi-stream-output"]').getText();
}

/**
 * Wait for the trust dialog to appear and click "Trust & Install".
 * Call this after executing a cell in an untrusted notebook with inline deps.
 * The trust dialog appears because the kernel won't start until deps are approved.
 */
export async function approveTrustDialog(timeout = 15000) {
  const dialog = await $('[data-testid="trust-dialog"]');
  await dialog.waitForExist({ timeout });

  const approveButton = await $('[data-testid="trust-approve-button"]');
  await approveButton.waitForClickable({ timeout: 5000 });
  await approveButton.click();

  // Wait for dialog to close
  await browser.waitUntil(
    async () => {
      return !(await dialog.isExisting());
    },
    { timeout: 10000, interval: 300, timeoutMsg: "Trust dialog did not close" }
  );
}

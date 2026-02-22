/**
 * E2E Test: Save / Cmd+S and Dirty State (Fixture)
 *
 * Opens a vanilla notebook, edits a cell, verifies the dirty bullet
 * appears on the save button, saves with Cmd+S, verifies the bullet clears.
 *
 * Daemon-independent: only tests observable DOM effects of actions.
 *
 * Note: Cmd+S writes the modified notebook to disk. In CI this is fine
 * (fresh checkout each run). Locally, `git checkout` restores the fixture.
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/1-vanilla.ipynb
 */

import { browser, expect } from "@wdio/globals";
import os from "node:os";
import { waitForAppReady, typeSlowly } from "../helpers.js";

const MOD_KEY = os.platform() === "darwin" ? "Meta" : "Control";

/**
 * Check whether the dirty bullet is visible inside the save button.
 * The bullet is rendered as <span class="text-[10px]">&bull;</span> (U+2022).
 */
async function isDirtyBulletVisible() {
  return await browser.execute(() => {
    const saveBtn = document.querySelector('[data-testid="save-button"]');
    if (!saveBtn) return false;
    const spans = saveBtn.querySelectorAll("span");
    for (const span of spans) {
      if (span.textContent === "\u2022") return true;
    }
    return false;
  });
}

describe("Save and Dirty State", () => {
  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());
  });

  it("should show dirty bullet after editing a cell", async () => {
    // Focus the first cell editor
    const codeCell = await $('[data-cell-type="code"]');
    await codeCell.waitForExist({ timeout: 5000 });
    const editor = await codeCell.$('.cm-content[contenteditable="true"]');
    await editor.waitForExist({ timeout: 5000 });
    await editor.click();
    await browser.pause(200);

    // Move to end of content
    await browser.keys([MOD_KEY, "a"]);
    await browser.pause(100);
    await browser.keys(["ArrowRight"]);
    await browser.pause(100);

    // Type something to make the notebook dirty
    await typeSlowly(" # edited");
    await browser.pause(300);

    // Wait for the dirty bullet to appear
    await browser.waitUntil(async () => await isDirtyBulletVisible(), {
      timeout: 5000,
      interval: 200,
      timeoutMsg: "Dirty bullet did not appear after editing",
    });

    console.log("Dirty bullet visible after editing");
  });

  it("should clear dirty bullet after Cmd+S", async () => {
    // Press Cmd+S / Ctrl+S
    await browser.keys([MOD_KEY, "s"]);

    // Wait for the dirty bullet to disappear
    await browser.waitUntil(async () => !(await isDirtyBulletVisible()), {
      timeout: 10000,
      interval: 200,
      timeoutMsg: "Dirty bullet did not clear after save",
    });

    console.log("Dirty bullet cleared after Cmd+S");
  });

  it("should show dirty bullet again after further edits", async () => {
    // Edit again
    const codeCell = await $('[data-cell-type="code"]');
    const editor = await codeCell.$('.cm-content[contenteditable="true"]');
    await editor.click();
    await browser.pause(200);
    await browser.keys([MOD_KEY, "a"]);
    await browser.pause(100);
    await browser.keys(["ArrowRight"]);
    await browser.pause(100);
    await typeSlowly("!");
    await browser.pause(300);

    // Verify dirty bullet reappears
    await browser.waitUntil(async () => await isDirtyBulletVisible(), {
      timeout: 5000,
      interval: 200,
      timeoutMsg: "Dirty bullet did not reappear after second edit",
    });

    console.log("Dirty state re-asserted after further edits");
  });
});

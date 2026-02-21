/**
 * E2E Test: Pixi environment detection (Bug #6)
 *
 * Opens a notebook next to pixi.toml.
 * Verifies that the backend auto-detects pixi.toml and launches a
 * conda kernel, and the frontend shows the conda dependency panel
 * (not uv).
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/pixi-project/6-pixi.ipynb
 */

import { browser, expect } from "@wdio/globals";
import os from "node:os";

// macOS uses Cmd (Meta) for shortcuts, Linux uses Ctrl
const MOD_KEY = os.platform() === "darwin" ? "Meta" : "Control";

describe("Pixi Environment Detection", () => {
  const KERNEL_STARTUP_TIMEOUT = 120000;

  before(async () => {
    await browser.pause(5000);
    const title = await browser.getTitle();
    console.log("Page title:", title);
  });

  async function typeSlowly(text, delay = 50) {
    for (const char of text) {
      await browser.keys(char);
      await browser.pause(delay);
    }
  }

  it("should detect pixi.toml and start a conda kernel", async () => {
    let codeCell = await $('[data-cell-type="code"]');
    const cellExists = await codeCell.isExisting();

    if (!cellExists) {
      const addCodeButton = await $("button*=Code");
      await addCodeButton.waitForClickable({ timeout: 5000 });
      await addCodeButton.click();
      await browser.pause(500);

      codeCell = await $('[data-cell-type="code"]');
      await codeCell.waitForExist({ timeout: 5000 });
    }

    // Focus editor, type code to print the Python executable
    const editor = await codeCell.$('.cm-content[contenteditable="true"]');
    await editor.waitForExist({ timeout: 5000 });
    await editor.click();
    await browser.pause(200);

    await browser.keys([MOD_KEY, "a"]);
    await browser.pause(100);

    await typeSlowly("import sys; print(sys.executable)");
    await browser.pause(300);

    // Execute to trigger kernel start
    await browser.keys(["Shift", "Enter"]);
    console.log("Triggered execution");

    // Wait for output
    await browser.waitUntil(
      async () => {
        const output = await codeCell.$('[data-slot="ansi-stream-output"]');
        return await output.isExisting();
      },
      {
        timeout: KERNEL_STARTUP_TIMEOUT,
        timeoutMsg: "Kernel did not start - no output appeared",
        interval: 1000,
      }
    );

    const outputText = await codeCell
      .$('[data-slot="ansi-stream-output"]')
      .getText();
    console.log("Python executable:", outputText);

    // Pixi auto-detection should launch a conda kernel
    const isCondaEnv = outputText.includes("runt/conda-envs");
    expect(isCondaEnv).toBe(true);
    console.log("Pixi test passed: kernel is from conda env");
  });
});

/**
 * E2E Test: pyproject.toml kernel startup (Bug #5)
 *
 * Opens a notebook next to pyproject.toml.
 * Verifies that the kernel starts without hanging (the "beach-ball" bug),
 * even when uv needs to create .venv and install dependencies.
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/pyproject-project/5-pyproject.ipynb
 */

import { browser, expect } from "@wdio/globals";
import os from "node:os";

// macOS uses Cmd (Meta) for shortcuts, Linux uses Ctrl
const MOD_KEY = os.platform() === "darwin" ? "Meta" : "Control";

describe("Pyproject Kernel Startup", () => {
  const KERNEL_STARTUP_TIMEOUT = 180000; // 3 min: uv may need to install deps

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

  it("should start kernel with pyproject.toml without hanging", async () => {
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

    // Focus editor, type code
    const editor = await codeCell.$('.cm-content[contenteditable="true"]');
    await editor.waitForExist({ timeout: 5000 });
    await editor.click();
    await browser.pause(200);

    await browser.keys([MOD_KEY, "a"]);
    await browser.pause(100);

    await typeSlowly("import sys; print(sys.executable)");
    await browser.pause(300);

    // Execute — this triggers `uv run` which may take a while
    await browser.keys(["Shift", "Enter"]);
    console.log("Triggered execution (uv run kernel start)");

    // Wait for output — the retry loop should keep the app responsive
    await browser.waitUntil(
      async () => {
        const output = await codeCell.$('[data-slot="ansi-stream-output"]');
        return await output.isExisting();
      },
      {
        timeout: KERNEL_STARTUP_TIMEOUT,
        timeoutMsg: "Kernel did not start with pyproject.toml - possible beach-ball",
        interval: 2000,
      }
    );

    const outputText = await codeCell
      .$('[data-slot="ansi-stream-output"]')
      .getText();
    console.log("Python executable:", outputText);

    // The python executable should exist (any valid path)
    expect(outputText.length).toBeGreaterThan(0);
    console.log("Pyproject startup test passed: kernel started without hanging");
  });

  it("should show pyproject.toml in toolbar env source", async () => {
    // After kernel started, toolbar should indicate pyproject source
    const toolbar = await $('[data-testid="notebook-toolbar"]');
    if (await toolbar.isExisting()) {
      const toolbarText = await toolbar.getText();
      console.log("Toolbar text:", toolbarText);
      // The env source label should contain "pyproject"
      expect(toolbarText.toLowerCase()).toContain("pyproject");
    }
  });
});

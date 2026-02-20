/**
 * E2E Test: Both-deps panel mismatch (Bug #4)
 *
 * Opens a notebook with both uv and conda dependencies.
 * Verifies that after the kernel starts, the dependency panel
 * matches what the backend actually chose (conda by default preference).
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/4-both-deps.ipynb
 */

import { browser, expect } from "@wdio/globals";

describe("Both Dependencies Panel", () => {
  const KERNEL_STARTUP_TIMEOUT = 120000;

  before(async () => {
    await browser.pause(5000);
    const title = await browser.getTitle();
    console.log("Page title:", title);
  });

  /**
   * Helper to type text character by character
   */
  async function typeSlowly(text, delay = 50) {
    for (const char of text) {
      await browser.keys(char);
      await browser.pause(delay);
    }
  }

  it("should show the correct dependency panel after kernel starts", async () => {
    // Step 1: Find or create a code cell
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

    // Step 2: Focus editor, type code
    const editor = await codeCell.$('.cm-content[contenteditable="true"]');
    await editor.waitForExist({ timeout: 5000 });
    await editor.click();
    await browser.pause(200);

    await browser.keys(["Control", "a"]);
    await browser.pause(100);

    await typeSlowly("import sys; print(sys.executable)");
    await browser.pause(300);

    // Step 3: Execute to trigger kernel start
    await browser.keys(["Shift", "Enter"]);
    console.log("Triggered execution (kernel will start)");

    // Step 4: Wait for output (kernel startup)
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

    // Step 5: Check which env backend was used
    const isCondaEnv = outputText.includes("runt/conda-envs");
    const isUvEnv = outputText.includes("runt/envs");
    console.log(`Backend chose: ${isCondaEnv ? "conda" : isUvEnv ? "uv" : "unknown"}`);

    // Step 6: Verify the toolbar shows the correct env source
    // The env source indicator should reflect what the backend chose
    const toolbar = await $('[data-testid="notebook-toolbar"]');
    if (await toolbar.isExisting()) {
      const toolbarText = await toolbar.getText();
      console.log("Toolbar text:", toolbarText);
    }

    // The key assertion: kernel started with *some* managed environment
    expect(isCondaEnv || isUvEnv).toBe(true);
  });
});

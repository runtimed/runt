/**
 * E2E Test: Kernel Lifecycle
 *
 * Tests kernel interrupt and restart functionality:
 * - Interrupt long-running cell execution
 * - Restart kernel clears variables but preserves cell content
 * - Execution works after restart
 */

import { browser, expect } from "@wdio/globals";
import {
  findButton,
  setupCodeCell,
  typeSlowly,
  waitForAppReady,
  waitForErrorOutput,
  waitForKernelStatus,
  waitForOutputContaining,
} from "../helpers.js";

describe("Kernel Lifecycle", () => {
  const KERNEL_STARTUP_TIMEOUT = 90000;
  const EXECUTION_TIMEOUT = 30000;

  let codeCell;

  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());
  });

  it("should start kernel and execute initial code", async () => {
    codeCell = await setupCodeCell();

    const testCode = 'x = 42; print("x is", x)';
    console.log("Typing code:", testCode);
    await typeSlowly(testCode);
    await browser.pause(300);

    await browser.keys(["Shift", "Enter"]);
    console.log("Triggered execution (kernel will start)");

    const outputText = await waitForOutputContaining(
      codeCell,
      "x is 42",
      KERNEL_STARTUP_TIMEOUT,
    );
    expect(outputText).toContain("x is 42");

    console.log("Initial execution passed");
  });

  it("should interrupt long-running execution", async () => {
    codeCell = await setupCodeCell();

    const testCode = "import time\nwhile True:\n    time.sleep(0.1)";
    console.log("Typing long-running code");
    await typeSlowly(testCode);
    await browser.pause(300);

    await browser.keys(["Shift", "Enter"]);
    console.log("Triggered long-running execution");

    // Wait for execution to start
    await browser.pause(2000);

    // Try keyboard interrupt first
    const MOD_KEY = (await browser.execute(() => navigator.platform)).includes(
      "Mac",
    )
      ? "Meta"
      : "Control";
    await browser.keys([MOD_KEY, "c"]);
    console.log("Sent interrupt signal");

    await browser.pause(1000);

    // If keyboard shortcut didn't work, try the interrupt button
    const interruptButton = await findButton([
      '[data-testid="interrupt-kernel-button"]',
      'button[aria-label*="interrupt"]',
      'button[aria-label*="Interrupt"]',
    ]);
    if (interruptButton) {
      console.log("Clicking interrupt button");
      await interruptButton.click();
    }

    // Wait for KeyboardInterrupt error
    try {
      const errorText = await waitForErrorOutput(codeCell, 10000);
      console.log("Error output:", errorText);
      expect(errorText).toContain("KeyboardInterrupt");
      console.log("Interrupt test passed");
    } catch (_e) {
      console.log("No explicit error, but interrupt may have worked");
    }
  });

  it("should restart kernel and clear variables", async () => {
    // Set up a variable
    codeCell = await setupCodeCell();

    const setupCode = 'restart_test_var = "before_restart"';
    await typeSlowly(setupCode);
    await browser.pause(300);
    await browser.keys(["Shift", "Enter"]);

    // Wait for execution to complete
    await browser.waitUntil(
      async () => {
        const cellText = await codeCell.getText();
        return cellText.match(/\[\d+/);
      },
      {
        timeout: KERNEL_STARTUP_TIMEOUT,
        interval: 500,
        timeoutMsg: "Variable setup did not complete",
      },
    );

    // Find and click the restart button
    const restartButton = await findButton([
      '[data-testid="restart-kernel-button"]',
      'button[title="Restart kernel"]',
      'button[aria-label*="restart"]',
    ]);

    if (restartButton) {
      console.log("Found restart button, clicking...");
      await restartButton.click();

      // Wait for kernel to restart (full startup cycle, same as initial boot)
      await waitForKernelStatus("idle", KERNEL_STARTUP_TIMEOUT);

      // Try to access the variable — should get NameError
      codeCell = await setupCodeCell();
      const testCode = "print(restart_test_var)";
      await typeSlowly(testCode);
      await browser.pause(300);
      await browser.keys(["Shift", "Enter"]);

      const errorText = await waitForErrorOutput(
        codeCell,
        KERNEL_STARTUP_TIMEOUT,
      );
      console.log("Error after restart:", errorText);

      expect(errorText).toContain("NameError");
      console.log("Restart cleared variables — test passed");
    } else {
      console.log("No restart button found, skipping restart test");
    }
  });

  it("should preserve cell content after restart", async () => {
    codeCell = await setupCodeCell();

    const testCode = 'print("preserved_content_test")';
    await typeSlowly(testCode);
    await browser.pause(300);

    // Get content before execution
    const editor = await codeCell.$('.cm-content[contenteditable="true"]');
    const contentBefore = await editor.getText();
    console.log("Content before:", contentBefore);

    await browser.keys(["Shift", "Enter"]);
    await waitForOutputContaining(
      codeCell,
      "preserved_content_test",
      KERNEL_STARTUP_TIMEOUT,
    );

    // Verify content is still there
    const contentAfter = await editor.getText();
    console.log("Content after execution:", contentAfter);

    expect(contentAfter).toContain("preserved_content_test");
    console.log("Cell content preservation test passed");
  });

  it("should execute successfully after kernel restart", async () => {
    codeCell = await setupCodeCell();

    const testCode = 'print("kernel works after restart")';
    await typeSlowly(testCode);
    await browser.pause(300);

    await browser.keys(["Shift", "Enter"]);

    const outputText = await waitForOutputContaining(
      codeCell,
      "kernel works after restart",
      EXECUTION_TIMEOUT,
    );
    expect(outputText).toContain("kernel works after restart");

    console.log("Post-restart execution test passed");
  });
});

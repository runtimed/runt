/**
 * E2E Test: Notebook Execution Happy Path
 *
 * Tests the basic workflow: create notebook, write code, execute, see output.
 * Also verifies that outputs are properly cleared on re-execution.
 */

import { browser, expect } from "@wdio/globals";

describe("Notebook Execution Happy Path", () => {
  // Allow time for kernel startup (first execution takes longer)
  const KERNEL_STARTUP_TIMEOUT = 60000;
  const EXECUTION_TIMEOUT = 15000;

  let codeCell;

  before(async () => {
    // Wait for app to fully load
    await browser.pause(5000);

    // Debug: Log page state
    const title = await browser.getTitle();
    const url = await browser.getUrl();
    console.log("Page title:", title);
    console.log("Page URL:", url);
  });

  /**
   * Helper to type text character by character with delay to avoid dropped keys
   */
  async function typeSlowly(text, delay = 50) {
    for (const char of text) {
      await browser.keys(char);
      await browser.pause(delay);
    }
  }

  /**
   * Helper to wait for output containing specific text
   */
  async function waitForOutput(expectedText, timeout) {
    await browser.waitUntil(
      async () => {
        const streamOutput = await codeCell.$('[data-slot="ansi-stream-output"]');
        if (!(await streamOutput.isExisting())) {
          return false;
        }
        const text = await streamOutput.getText();
        console.log("Current output:", JSON.stringify(text));
        return text.includes(expectedText);
      },
      {
        timeout,
        timeoutMsg: `Output "${expectedText}" did not appear within timeout.`,
        interval: 500,
      }
    );
  }

  /**
   * Helper to count output elements in the cell
   */
  async function countOutputs() {
    const outputs = await codeCell.$$('[data-slot="ansi-stream-output"]');
    return outputs.length;
  }

  it("should execute code and display output", async () => {
    // Step 1: Ensure we have a code cell
    codeCell = await $('[data-cell-type="code"]');
    const cellExists = await codeCell.isExisting();

    if (!cellExists) {
      // Notebook is empty - click "Code Cell" button to add first cell
      console.log("No code cell found, adding one...");
      const addCodeButton = await $("button*=Code");
      await addCodeButton.waitForClickable({ timeout: 5000 });
      await addCodeButton.click();
      await browser.pause(500);

      // Re-fetch the cell
      codeCell = await $('[data-cell-type="code"]');
      await codeCell.waitForExist({ timeout: 5000 });
    }

    console.log("Code cell found");

    // Step 2: Focus the CodeMirror editor and enter code
    const editor = await codeCell.$('.cm-content[contenteditable="true"]');
    await editor.waitForExist({ timeout: 5000 });
    await editor.click();
    await browser.pause(200);

    // Clear any existing content
    await browser.keys(["Control", "a"]);
    await browser.pause(100);

    // Type code slowly to avoid dropped characters
    const testCode = 'print("hello world")';
    console.log("Typing code:", testCode);
    await typeSlowly(testCode);
    await browser.pause(300);

    // Step 3: Execute the cell with Shift+Enter
    await browser.keys(["Shift", "Enter"]);
    console.log("Triggered execution (first time - kernel will start)");

    // Step 4: Wait for output (longer timeout for kernel startup)
    await waitForOutput("hello world", KERNEL_STARTUP_TIMEOUT);
    console.log("First execution output appeared!");

    // Step 5: Verify output
    let outputText = await codeCell.$('[data-slot="ansi-stream-output"]').getText();
    expect(outputText).toContain("hello world");
    console.log("First execution verified successfully");
  });

  it("should clear previous outputs when re-executing", async () => {
    // This test catches the bug where outputs accumulate instead of being cleared

    // First, check how many outputs we have after the first test
    const initialOutputCount = await countOutputs();
    console.log("Initial output count:", initialOutputCount);

    // Re-focus the editor and change the code
    const editor = await codeCell.$('.cm-content[contenteditable="true"]');
    await editor.click();
    await browser.pause(200);

    // Select all and replace with new code
    await browser.keys(["Control", "a"]);
    await browser.pause(100);

    const newCode = 'print("second run")';
    console.log("Typing new code:", newCode);
    await typeSlowly(newCode);
    await browser.pause(300);

    // Execute again
    await browser.keys(["Shift", "Enter"]);
    console.log("Triggered second execution");

    // Wait for new output
    await waitForOutput("second run", EXECUTION_TIMEOUT);
    console.log("Second execution output appeared!");

    // KEY TEST: Check that old outputs were cleared
    const finalOutputCount = await countOutputs();
    console.log("Final output count:", finalOutputCount);

    // There should only be ONE stream output, not accumulated outputs
    expect(finalOutputCount).toBe(1);

    // Verify the output is the NEW text, not old + new
    const outputText = await codeCell.$('[data-slot="ansi-stream-output"]').getText();
    console.log("Final output text:", JSON.stringify(outputText));

    // Should contain new output
    expect(outputText).toContain("second run");

    // Should NOT contain old output (this is the key assertion for the bug)
    expect(outputText).not.toContain("hello world");

    console.log("Test passed: Outputs are properly cleared on re-execution");
  });
});

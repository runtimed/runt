/**
 * E2E Test: Error Handling
 *
 * Tests that errors are properly displayed:
 * - Syntax errors show traceback
 * - Runtime exceptions (ZeroDivisionError) show formatted output
 * - ImportError for missing packages shows helpful message
 */

import { browser, expect } from "@wdio/globals";

describe("Error Handling", () => {
  const KERNEL_STARTUP_TIMEOUT = 60000;
  const EXECUTION_TIMEOUT = 15000;

  let codeCell;

  before(async () => {
    // Wait for app to fully load
    await browser.pause(5000);

    const title = await browser.getTitle();
    console.log("Page title:", title);
  });

  /**
   * Helper to type text character by character with delay
   */
  async function typeSlowly(text, delay = 50) {
    for (const char of text) {
      await browser.keys(char);
      await browser.pause(delay);
    }
  }

  /**
   * Helper to wait for error output to appear
   */
  async function waitForError(timeout) {
    await browser.waitUntil(
      async () => {
        const errorOutput = await codeCell.$('[data-slot="ansi-error-output"]');
        return await errorOutput.isExisting();
      },
      {
        timeout,
        timeoutMsg: "Error output did not appear within timeout.",
        interval: 500,
      }
    );
  }

  /**
   * Helper to ensure we have a code cell and focus the editor
   */
  async function setupCodeCell() {
    codeCell = await $('[data-cell-type="code"]');
    const cellExists = await codeCell.isExisting();

    if (!cellExists) {
      console.log("No code cell found, adding one...");
      const addCodeButton = await $("button*=Code");
      await addCodeButton.waitForClickable({ timeout: 5000 });
      await addCodeButton.click();
      await browser.pause(500);

      codeCell = await $('[data-cell-type="code"]');
      await codeCell.waitForExist({ timeout: 5000 });
    }

    const editor = await codeCell.$('.cm-content[contenteditable="true"]');
    await editor.waitForExist({ timeout: 5000 });
    await editor.click();
    await browser.pause(200);

    // Clear any existing content
    await browser.keys(["Control", "a"]);
    await browser.pause(100);
  }

  it("should display syntax error traceback", async () => {
    await setupCodeCell();

    // Type code with syntax error (missing closing parenthesis)
    const testCode = 'print("hello"';
    console.log("Typing code with syntax error:", testCode);
    await typeSlowly(testCode);
    await browser.pause(300);

    // Execute
    await browser.keys(["Shift", "Enter"]);
    console.log("Triggered execution");

    // Wait for error output
    await waitForError(KERNEL_STARTUP_TIMEOUT);

    // Verify error content
    const errorOutput = await codeCell.$('[data-slot="ansi-error-output"]');
    const errorText = await errorOutput.getText();
    console.log("Error output:", errorText);

    // Should contain SyntaxError indication
    expect(
      errorText.includes("SyntaxError") || errorText.includes("syntax")
    ).toBe(true);

    console.log("Syntax error test passed");
  });

  it("should display ZeroDivisionError", async () => {
    await setupCodeCell();

    // Type code that causes division by zero
    const testCode = "1 / 0";
    console.log("Typing code:", testCode);
    await typeSlowly(testCode);
    await browser.pause(300);

    // Execute
    await browser.keys(["Shift", "Enter"]);
    console.log("Triggered execution");

    // Wait for error output
    await waitForError(EXECUTION_TIMEOUT);

    // Verify error content
    const errorOutput = await codeCell.$('[data-slot="ansi-error-output"]');
    const errorText = await errorOutput.getText();
    console.log("Error output:", errorText);

    expect(errorText).toContain("ZeroDivisionError");

    console.log("ZeroDivisionError test passed");
  });

  it("should display ImportError for missing packages", async () => {
    await setupCodeCell();

    // Import a package that doesn't exist
    const testCode = "import nonexistent_package_xyz123";
    console.log("Typing code:", testCode);
    await typeSlowly(testCode);
    await browser.pause(300);

    // Execute
    await browser.keys(["Shift", "Enter"]);
    console.log("Triggered execution");

    // Wait for error output
    await waitForError(EXECUTION_TIMEOUT);

    // Verify error content
    const errorOutput = await codeCell.$('[data-slot="ansi-error-output"]');
    const errorText = await errorOutput.getText();
    console.log("Error output:", errorText);

    // Should contain ModuleNotFoundError or ImportError
    expect(
      errorText.includes("ModuleNotFoundError") ||
        errorText.includes("ImportError")
    ).toBe(true);

    console.log("ImportError test passed");
  });

  it("should display NameError for undefined variables", async () => {
    await setupCodeCell();

    // Reference undefined variable
    const testCode = "undefined_variable_xyz";
    console.log("Typing code:", testCode);
    await typeSlowly(testCode);
    await browser.pause(300);

    // Execute
    await browser.keys(["Shift", "Enter"]);
    console.log("Triggered execution");

    // Wait for error output
    await waitForError(EXECUTION_TIMEOUT);

    // Verify error content
    const errorOutput = await codeCell.$('[data-slot="ansi-error-output"]');
    const errorText = await errorOutput.getText();
    console.log("Error output:", errorText);

    expect(errorText).toContain("NameError");

    console.log("NameError test passed");
  });

  it("should display TypeError for invalid operations", async () => {
    await setupCodeCell();

    // Type code that causes TypeError
    const testCode = '"hello" + 5';
    console.log("Typing code:", testCode);
    await typeSlowly(testCode);
    await browser.pause(300);

    // Execute
    await browser.keys(["Shift", "Enter"]);
    console.log("Triggered execution");

    // Wait for error output
    await waitForError(EXECUTION_TIMEOUT);

    // Verify error content
    const errorOutput = await codeCell.$('[data-slot="ansi-error-output"]');
    const errorText = await errorOutput.getText();
    console.log("Error output:", errorText);

    expect(errorText).toContain("TypeError");

    console.log("TypeError test passed");
  });
});

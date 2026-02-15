/**
 * E2E Test: Environment Detection Happy Path
 *
 * Verifies that the application correctly detects and uses
 * the appropriate environment backend (uv or conda/rattler).
 * Tests that:
 * 1. Kernel starts successfully with a managed environment
 * 2. Python executable is from the correct cache directory
 * 3. ipykernel is available in the environment
 */

import { browser, expect } from "@wdio/globals";

describe("Environment Detection", () => {
  // Allow extra time for environment creation on first run
  const KERNEL_STARTUP_TIMEOUT = 120000;
  const EXECUTION_TIMEOUT = 15000;

  let codeCell;

  before(async () => {
    // Wait for app to fully load
    await browser.pause(5000);

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

  it("should detect environment type and start kernel successfully", async () => {
    // Step 1: Ensure we have a code cell
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

    console.log("Code cell found");

    // Step 2: Focus the CodeMirror editor
    const editor = await codeCell.$('.cm-content[contenteditable="true"]');
    await editor.waitForExist({ timeout: 5000 });
    await editor.click();
    await browser.pause(200);

    // Clear any existing content
    await browser.keys(["Control", "a"]);
    await browser.pause(100);

    // Step 3: Type code to print the Python executable path
    const testCode = "import sys; print(sys.executable)";
    console.log("Typing code:", testCode);
    await typeSlowly(testCode);
    await browser.pause(300);

    // Step 4: Execute the cell
    await browser.keys(["Shift", "Enter"]);
    console.log("Triggered execution (kernel will start)");

    // Step 5: Wait for output (longer timeout for kernel startup)
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

    // Step 6: Verify the Python path is from a managed environment
    const outputText = await codeCell
      .$('[data-slot="ansi-stream-output"]')
      .getText();
    console.log("Python executable:", outputText);

    // Should be from either runt/envs (uv) or runt/conda-envs (conda)
    const isUvEnv = outputText.includes("runt/envs");
    const isCondaEnv = outputText.includes("runt/conda-envs");

    expect(isUvEnv || isCondaEnv).toBe(true);

    const envType = isUvEnv ? "uv" : "conda";
    console.log(`Environment type detected: ${envType}`);
    console.log("Test passed: Kernel started with managed environment");
  });

  it("should have ipykernel available in the environment", async () => {
    // This test depends on the previous test having started the kernel

    // Focus editor and type code to check ipykernel
    const editor = await codeCell.$('.cm-content[contenteditable="true"]');
    await editor.click();
    await browser.pause(200);

    // Clear and type new code
    await browser.keys(["Control", "a"]);
    await browser.pause(100);

    const testCode = 'import ipykernel; print(f"ipykernel {ipykernel.__version__}")';
    console.log("Typing code:", testCode);
    await typeSlowly(testCode);
    await browser.pause(300);

    // Execute
    await browser.keys(["Shift", "Enter"]);
    console.log("Triggered execution");

    // Wait for ipykernel output
    await waitForOutput("ipykernel", EXECUTION_TIMEOUT);

    const outputText = await codeCell
      .$('[data-slot="ansi-stream-output"]')
      .getText();
    expect(outputText).toContain("ipykernel");
    console.log("ipykernel check passed:", outputText);
  });

  it("should be able to execute Python code in the environment", async () => {
    // Verify the environment is fully functional by running some code

    const editor = await codeCell.$('.cm-content[contenteditable="true"]');
    await editor.click();
    await browser.pause(200);

    await browser.keys(["Control", "a"]);
    await browser.pause(100);

    // Simple computation to verify the kernel is working
    const testCode = "print(2 + 2)";
    console.log("Typing code:", testCode);
    await typeSlowly(testCode);
    await browser.pause(300);

    await browser.keys(["Shift", "Enter"]);

    await waitForOutput("4", EXECUTION_TIMEOUT);

    const outputText = await codeCell
      .$('[data-slot="ansi-stream-output"]')
      .getText();
    expect(outputText).toContain("4");
    console.log("Computation test passed");
  });
});

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
import {
  waitForAppReady,
  setupCodeCell,
  typeSlowly,
  waitForCellOutput,
  waitForOutputContaining,
} from "../helpers.js";

describe("Environment Detection", () => {
  const KERNEL_STARTUP_TIMEOUT = 120000;
  const EXECUTION_TIMEOUT = 15000;

  let codeCell;

  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());
  });

  it("should detect environment type and start kernel successfully", async () => {
    codeCell = await setupCodeCell();

    const testCode = "import sys; print(sys.executable)";
    console.log("Typing code:", testCode);
    await typeSlowly(testCode);
    await browser.pause(300);

    // Execute
    await browser.keys(["Shift", "Enter"]);
    console.log("Triggered execution (kernel will start)");

    // Wait for output (longer timeout for kernel startup)
    const outputText = await waitForCellOutput(codeCell, KERNEL_STARTUP_TIMEOUT);
    console.log("Python executable:", outputText);

    // Should be from either runt/envs (uv) or runt/conda-envs (conda)
    const isUvEnv = outputText.includes("runt/envs");
    const isCondaEnv = outputText.includes("runt/conda-envs");

    expect(isUvEnv || isCondaEnv).toBe(true);

    const envType = isUvEnv ? "uv" : "conda";
    console.log(`Environment type detected: ${envType}`);
  });

  it("should have ipykernel available in the environment", async () => {
    codeCell = await setupCodeCell();

    const testCode = 'import ipykernel; print(f"ipykernel {ipykernel.__version__}")';
    console.log("Typing code:", testCode);
    await typeSlowly(testCode);
    await browser.pause(300);

    await browser.keys(["Shift", "Enter"]);
    console.log("Triggered execution");

    const outputText = await waitForOutputContaining(codeCell, "ipykernel", EXECUTION_TIMEOUT);
    expect(outputText).toContain("ipykernel");
    console.log("ipykernel check passed:", outputText);
  });

  it("should be able to execute Python code in the environment", async () => {
    codeCell = await setupCodeCell();

    const testCode = "print(2 + 2)";
    console.log("Typing code:", testCode);
    await typeSlowly(testCode);
    await browser.pause(300);

    await browser.keys(["Shift", "Enter"]);

    const outputText = await waitForOutputContaining(codeCell, "4", EXECUTION_TIMEOUT);
    expect(outputText).toContain("4");
    console.log("Computation test passed");
  });
});

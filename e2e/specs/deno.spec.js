/**
 * E2E Test: Deno Kernel
 *
 * Verifies that notebooks with Deno kernelspec are detected correctly
 * and launch with the Deno runtime (not Python).
 *
 * Fixture: 10-deno.ipynb (has kernelspec.name = "deno")
 */

import { browser } from "@wdio/globals";
import {
  executeFirstCell,
  waitForCellOutput,
  waitForKernelReady,
} from "../helpers.js";

describe("Deno Kernel", () => {
  it("should auto-launch Deno kernel", async () => {
    // Wait for kernel to auto-launch (90s, includes deno bootstrap if needed)
    await waitForKernelReady(90000);
  });

  it("should execute TypeScript and show output", async () => {
    // Execute the first cell which logs "deno:ok" and version
    const cell = await executeFirstCell();

    // Wait for output
    const output = await waitForCellOutput(cell, 30000);

    // Verify Deno executed the code
    expect(output).toContain("deno:ok");
    expect(output).toContain("version:");
  });
});

/**
 * E2E Test: Prewarmed UV Pool
 *
 * Verifies that basic Python notebooks use prewarmed UV environments
 * from the daemon's pool for fast startup.
 *
 * Fixture: 1-vanilla.ipynb (no inline deps, no project file)
 */

import { browser } from "@wdio/globals";
import {
  executeFirstCell,
  waitForCellOutput,
  waitForKernelReady,
  isManagedEnv,
} from "../helpers.js";

describe("Prewarmed UV Pool", () => {
  it("should auto-launch kernel from UV pool", async () => {
    // Wait for kernel to auto-launch (90s for first startup)
    await waitForKernelReady(90000);
  });

  it("should execute code and show managed env path", async () => {
    // Execute the cell which prints sys.executable
    const cell = await executeFirstCell();

    // Wait for output
    const output = await waitForCellOutput(cell, 30000);

    // Verify it's a managed environment (runtimed-uv-* path)
    expect(isManagedEnv(output)).toBe(true);
    expect(output).toContain("runtimed-uv");
  });
});

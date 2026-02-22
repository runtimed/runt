/**
 * E2E Test: Deno Runtime (Fixture #10)
 *
 * Opens a notebook with runtime="deno" in metadata.
 * Verifies:
 *   - The app loads and shows the Deno runtime badge
 *   - The Deno kernel starts successfully
 *   - TypeScript code executes and produces output
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/10-deno.ipynb
 */

import { browser, expect } from "@wdio/globals";
import {
  waitForAppReady,
  executeFirstCell,
  waitForOutputContaining,
} from "../helpers.js";

describe("Deno Runtime", () => {
  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());
  });

  it("should show the Deno runtime badge in the toolbar", async () => {
    const isDenoBadge = await browser.execute(() => {
      return !!document.querySelector('[title="Deno/TypeScript notebook"]');
    });
    expect(isDenoBadge).toBe(true);
    console.log("Deno runtime badge visible");
  });

  it("should start Deno kernel and execute TypeScript code", async () => {
    const codeCell = await executeFirstCell();
    console.log("Triggered execution");

    const outputText = await waitForOutputContaining(
      codeCell,
      "deno:ok",
      120000,
    );
    console.log("Output:", outputText);

    expect(outputText).toContain("deno:ok");
    expect(outputText).toContain("version:");
    console.log("Deno kernel execution verified");
  });
});

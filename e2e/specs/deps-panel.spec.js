/**
 * E2E Test: Dependencies Panel (Fixture)
 *
 * Opens a notebook with UV inline deps (2-uv-inline.ipynb).
 * Verifies the dependencies panel UI: opening it, viewing existing deps,
 * adding a new dependency, and removing it.
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/2-uv-inline.ipynb
 */

import { browser, expect } from "@wdio/globals";
import {
  approveTrustDialog,
  executeFirstCell,
  typeSlowly,
  waitForAppReady,
  waitForCellOutput,
} from "../helpers.js";

describe("Dependencies Panel", () => {
  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());
  });

  it("should start kernel with trust approval", async () => {
    const codeCell = await executeFirstCell();
    console.log("Triggered execution — expecting trust dialog");

    await approveTrustDialog();
    console.log("Trust dialog approved");

    const outputText = await waitForCellOutput(codeCell, 120000);
    console.log("Python executable:", outputText);

    expect(outputText).toContain("runt/envs");
  });

  it("should open deps panel from toolbar", async () => {
    const depsToggle = await $('[data-testid="deps-toggle"]');
    await depsToggle.waitForClickable({ timeout: 5000 });
    await depsToggle.click();

    const depsPanel = await $('[data-testid="deps-panel"]');
    await depsPanel.waitForExist({ timeout: 5000 });
    console.log("Deps panel opened");
  });

  it("should show existing dependency from notebook metadata", async () => {
    // The 2-uv-inline fixture has "requests" as an inline dep
    const depsPanel = await $('[data-testid="deps-panel"]');

    const depText = await depsPanel.getText();
    console.log("Deps panel text:", depText);

    expect(depText).toContain("requests");
    console.log("Existing dependency 'requests' found in panel");
  });

  it("should add a new dependency", async () => {
    const addInput = await $('[data-testid="deps-add-input"]');
    await addInput.waitForExist({ timeout: 5000 });
    await addInput.click();
    await browser.pause(200);
    await typeSlowly("httpx");

    const addButton = await $('[data-testid="deps-add-button"]');
    await addButton.waitForClickable({ timeout: 5000 });
    await addButton.click();

    // Wait for the dep to appear in the panel
    await browser.waitUntil(
      async () => {
        const panelText = await $('[data-testid="deps-panel"]').getText();
        return panelText.includes("httpx");
      },
      {
        timeout: 10000,
        interval: 500,
        timeoutMsg: "httpx did not appear in deps panel",
      },
    );

    console.log("Added dependency 'httpx'");
  });

  it("should remove the added dependency", async () => {
    // Find the remove button for httpx (X button next to the dep badge)
    const removeButton = await browser.execute(() => {
      const badges = document.querySelectorAll(
        '[data-testid="deps-panel"] .font-mono',
      );
      for (const badge of badges) {
        if (badge.textContent.trim() === "httpx") {
          // The X button is a sibling of the text span
          const container = badge.closest("div");
          const btn = container?.querySelector("button");
          return !!btn;
        }
      }
      return false;
    });

    expect(removeButton).toBe(true);

    // Click the remove button via execute to target the right one
    await browser.execute(() => {
      const badges = document.querySelectorAll(
        '[data-testid="deps-panel"] .font-mono',
      );
      for (const badge of badges) {
        if (badge.textContent.trim() === "httpx") {
          const container = badge.closest("div");
          const btn = container?.querySelector("button");
          if (btn) btn.click();
          break;
        }
      }
    });

    // Wait for httpx to disappear
    await browser.waitUntil(
      async () => {
        const panelText = await $('[data-testid="deps-panel"]').getText();
        return !panelText.includes("httpx");
      },
      {
        timeout: 10000,
        interval: 500,
        timeoutMsg: "httpx was not removed from deps panel",
      },
    );

    // requests should still be there
    const panelText = await $('[data-testid="deps-panel"]').getText();
    expect(panelText).toContain("requests");
    console.log("Removed 'httpx', 'requests' still present");
  });
});

/**
 * E2E Test: Conda Dependencies Panel (Fixture)
 *
 * Opens a notebook with conda inline deps (3-conda-inline.ipynb).
 * Verifies the conda dependencies panel UI: opening it, viewing existing deps,
 * verifying channels, adding a new dependency, and removing it.
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/3-conda-inline.ipynb
 */

import { browser, expect } from "@wdio/globals";
import {
  waitForAppReady,
  executeFirstCell,
  waitForCellOutput,
  approveTrustDialog,
  typeSlowly,
} from "../helpers.js";

describe("Conda Dependencies Panel", () => {
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

    expect(outputText).toContain("runt/conda-envs");
  });

  it("should open conda deps panel from toolbar", async () => {
    const depsToggle = await $('[data-testid="deps-toggle"]');
    await depsToggle.waitForClickable({ timeout: 5000 });
    await depsToggle.click();

    const depsPanel = await $('[data-testid="conda-deps-panel"]');
    await depsPanel.waitForExist({ timeout: 5000 });
    console.log("Conda deps panel opened");
  });

  it("should show existing dependency from notebook metadata", async () => {
    // The 3-conda-inline fixture has "numpy" as an inline conda dep
    const depsPanel = await $('[data-testid="conda-deps-panel"]');
    const panelText = await depsPanel.getText();
    console.log("Conda deps panel text:", panelText);

    expect(panelText).toContain("numpy");
    console.log("Existing dependency 'numpy' found in panel");
  });

  it("should show conda-forge channel", async () => {
    const depsPanel = await $('[data-testid="conda-deps-panel"]');
    const panelText = await depsPanel.getText();

    expect(panelText).toContain("conda-forge");
    console.log("conda-forge channel displayed");
  });

  it("should add a new dependency", async () => {
    const addInput = await $('[data-testid="conda-deps-add-input"]');
    await addInput.waitForExist({ timeout: 5000 });
    await addInput.click();
    await browser.pause(200);
    await typeSlowly("scipy");

    const addButton = await $('[data-testid="conda-deps-add-button"]');
    await addButton.waitForClickable({ timeout: 5000 });
    await addButton.click();

    // Wait for the dep to appear
    await browser.waitUntil(
      async () => {
        const panelText = await $('[data-testid="conda-deps-panel"]').getText();
        return panelText.includes("scipy");
      },
      { timeout: 10000, interval: 500, timeoutMsg: "scipy did not appear in conda deps panel" }
    );

    console.log("Added dependency 'scipy'");
  });

  it("should remove the added dependency", async () => {
    // Use WebdriverIO's native click (W3C WebDriver action) instead of
    // browser.execute — native .click() doesn't reliably trigger React handlers in wry
    const removeBtn = await $('[data-testid="conda-deps-panel"] button[title="Remove scipy"]');
    await removeBtn.waitForClickable({ timeout: 5000 });
    console.log("Remove scipy button is clickable");
    await removeBtn.click();
    console.log("Clicked remove button via WebDriver");

    // Wait for scipy to disappear from the panel
    await browser.waitUntil(
      async () => {
        const panelText = await $('[data-testid="conda-deps-panel"]').getText();
        return !panelText.includes("scipy");
      },
      { timeout: 15000, interval: 500, timeoutMsg: "scipy was not removed from conda deps panel" }
    );

    // numpy should still be there
    const panelText = await $('[data-testid="conda-deps-panel"]').getText();
    expect(panelText).toContain("numpy");
    console.log("Removed 'scipy', 'numpy' still present");
  });
});

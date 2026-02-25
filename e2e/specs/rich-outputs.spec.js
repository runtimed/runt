/**
 * E2E Test: Rich Output Types (Fixture)
 *
 * Opens a notebook with pre-populated outputs (11-rich-outputs.ipynb) and
 * verifies that various output types render correctly without needing a kernel.
 *
 * Tests: PNG images, HTML in iframe, pandas DataFrame, multiple stream outputs,
 * mixed output types, and ANSI color codes.
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/11-rich-outputs.ipynb
 */

import { browser, expect } from "@wdio/globals";
import { waitForCodeCells } from "../helpers.js";

describe("Rich Output Types", () => {
  before(async () => {
    // Wait for the 6 pre-populated code cells to load
    await waitForCodeCells(6);
    console.log("Page title:", await browser.getTitle());
  });

  async function getCodeCells() {
    return await $$('[data-cell-type="code"]');
  }

  describe("Image outputs", () => {
    it("should render PNG image as img element with data or blob src", async () => {
      const cells = await getCodeCells();
      const cell = cells[0];

      // PNG display_data should render as an <img> tag
      await browser.waitUntil(
        async () => {
          const img = await cell.$("img");
          return await img.isExisting();
        },
        {
          timeout: 15000,
          interval: 500,
          timeoutMsg: "PNG image did not render",
        },
      );

      const img = await cell.$("img");
      const src = await img.getAttribute("src");
      console.log(
        "Image src type:",
        src ? `${src.substring(0, 50)}...` : "none",
      );
      expect(src.startsWith("data:") || src.startsWith("blob:")).toBe(true);
      console.log("PNG image test passed");
    });
  });

  describe("HTML outputs", () => {
    it("should render HTML in isolated iframe", async () => {
      const cells = await getCodeCells();
      const cell = cells[1];

      await browser.waitUntil(
        async () => {
          const iframe = await cell.$("iframe");
          return await iframe.isExisting();
        },
        {
          timeout: 15000,
          interval: 500,
          timeoutMsg: "HTML iframe did not appear",
        },
      );

      const iframe = await cell.$("iframe");
      console.log("HTML rendered in iframe - isolation working");

      const sandbox = await iframe.getAttribute("sandbox");
      console.log("Iframe sandbox:", sandbox);
      if (sandbox) {
        expect(sandbox).not.toContain("allow-same-origin");
      }
      console.log("HTML output test passed");
    });

    it("should render pandas DataFrame as HTML", async () => {
      const cells = await getCodeCells();
      const cell = cells[2];

      // DataFrame has text/html output — renders in an IsolatedFrame iframe
      const outputArea = await cell.$('[data-slot="output-area"]');
      await browser.waitUntil(
        async () => {
          const iframe = await outputArea.$("iframe");
          return await iframe.isExisting();
        },
        {
          timeout: 15000,
          interval: 500,
          timeoutMsg: "DataFrame iframe did not render",
        },
      );

      const iframe = await outputArea.$("iframe");
      expect(await iframe.isExisting()).toBe(true);
      console.log("DataFrame rendered in iframe");
      console.log("pandas DataFrame test passed");
    });
  });

  describe("Multiple outputs", () => {
    it("should display multiple outputs from a single cell", async () => {
      const cells = await getCodeCells();
      const cell = cells[3];

      await browser.waitUntil(
        async () => {
          const output = await cell.$('[data-slot="ansi-stream-output"]');
          if (!(await output.isExisting())) return false;
          const text = await output.getText();
          return text.includes("Third output");
        },
        {
          timeout: 15000,
          interval: 500,
          timeoutMsg: "Stream outputs did not render",
        },
      );

      const outputText = await cell
        .$('[data-slot="ansi-stream-output"]')
        .getText();
      console.log("Output text:", outputText);

      expect(outputText).toContain("First output");
      expect(outputText).toContain("Second output");
      expect(outputText).toContain("Third output");
      console.log("Multiple outputs test passed");
    });

    it("should display mixed output types", async () => {
      const cells = await getCodeCells();
      const cell = cells[4];

      // Mixed cell has stream + markdown display_data + stream.
      // When any output needs isolation (markdown does), all outputs go to iframe.
      const outputArea = await cell.$('[data-slot="output-area"]');
      await browser.waitUntil(
        async () => {
          const iframe = await outputArea.$("iframe");
          return await iframe.isExisting();
        },
        {
          timeout: 15000,
          interval: 500,
          timeoutMsg: "Mixed output iframe did not render",
        },
      );

      const iframe = await outputArea.$("iframe");
      expect(await iframe.isExisting()).toBe(true);
      console.log("Mixed outputs rendered in iframe");
      console.log("Mixed output types test passed");
    });
  });

  describe("ANSI colors in output", () => {
    it("should render ANSI color codes", async () => {
      const cells = await getCodeCells();
      const cell = cells[5];

      await browser.waitUntil(
        async () => {
          const output = await cell.$('[data-slot="ansi-stream-output"]');
          return await output.isExisting();
        },
        {
          timeout: 15000,
          interval: 500,
          timeoutMsg: "ANSI output did not render",
        },
      );

      const outputHtml = await cell
        .$('[data-slot="ansi-stream-output"]')
        .getHTML();
      console.log(
        "Output HTML contains ansi class:",
        outputHtml.includes("ansi-"),
      );

      const hasColorClasses =
        outputHtml.includes("ansi-red") ||
        outputHtml.includes("ansi-green") ||
        outputHtml.includes("ansi-blue") ||
        outputHtml.includes("color:");

      console.log("ANSI colors rendered:", hasColorClasses);
      expect(hasColorClasses).toBe(true);
      console.log("ANSI color test passed");
    });
  });
});

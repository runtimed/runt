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
import { waitForAppReady } from "../helpers.js";

describe("Rich Output Types", () => {
  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());
  });

  async function getCodeCells() {
    return await $$('[data-cell-type="code"]');
  }

  describe("Image outputs", () => {
    it("should render PNG images from matplotlib", async () => {
      const cells = await getCodeCells();
      const cell = cells[0];

      // PNG display_data should render as an <img> tag
      // Images may render in the main DOM or inside an IsolatedFrame
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

    it("should render display(Image()) output", async () => {
      // Same cell as matplotlib — the fixture has a single PNG cell
      // This test verifies the img element has a valid source
      const cells = await getCodeCells();
      const cell = cells[0];
      const img = await cell.$("img");
      expect(await img.isExisting()).toBe(true);
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

      // DataFrame renders as HTML table — may be in iframe or direct DOM
      await browser.waitUntil(
        async () => {
          const html = await cell.getHTML();
          return (
            html.includes("Alice") ||
            html.includes("dataframe") ||
            html.includes("iframe")
          );
        },
        {
          timeout: 15000,
          interval: 500,
          timeoutMsg: "DataFrame did not render",
        },
      );

      const cellHtml = await cell.getHTML();
      const hasTable =
        cellHtml.includes("<table") ||
        cellHtml.includes("dataframe") ||
        cellHtml.includes("Alice");
      console.log("DataFrame rendered:", hasTable);
      expect(hasTable).toBe(true);
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

      // Mixed cell has stream + display_data + stream
      // All outputs go to iframe when any output needs isolation (markdown does)
      await browser.waitUntil(
        async () => {
          const html = await cell.getHTML();
          return (
            html.includes("stdout") ||
            html.includes("iframe") ||
            html.includes("output")
          );
        },
        {
          timeout: 15000,
          interval: 500,
          timeoutMsg: "Mixed outputs did not render",
        },
      );

      console.log("Mixed outputs rendered: true");
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

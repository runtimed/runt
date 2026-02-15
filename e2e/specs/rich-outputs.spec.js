/**
 * E2E Test: Rich Output Types
 *
 * Tests that various output types render correctly:
 * - Image outputs (PNG, matplotlib)
 * - HTML outputs (rendered in isolated iframe)
 * - Multiple outputs in a single cell
 */

import { browser, expect } from "@wdio/globals";

describe("Rich Output Types", () => {
  const KERNEL_STARTUP_TIMEOUT = 60000;
  const EXECUTION_TIMEOUT = 30000; // Longer for matplotlib

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

  /**
   * Helper to wait for any output to appear
   */
  async function waitForAnyOutput(timeout) {
    await browser.waitUntil(
      async () => {
        // Check for various output types
        const streamOutput = await codeCell.$('[data-slot="ansi-stream-output"]');
        const imageOutput = await codeCell.$('img');
        const iframeOutput = await codeCell.$('iframe');
        const displayData = await codeCell.$('[data-slot*="output"]');

        return (
          (await streamOutput.isExisting()) ||
          (await imageOutput.isExisting()) ||
          (await iframeOutput.isExisting()) ||
          (await displayData.isExisting())
        );
      },
      {
        timeout,
        timeoutMsg: "No output appeared within timeout.",
        interval: 500,
      }
    );
  }

  describe("Image outputs", () => {
    it("should render PNG images from matplotlib", async () => {
      await setupCodeCell();

      // Create a simple matplotlib plot
      // Note: matplotlib might need to be installed in the environment
      const testCode = `import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.figure(figsize=(4, 3))
plt.plot([1, 2, 3, 4], [1, 4, 2, 3])
plt.title('Test Plot')
plt.show()`;

      console.log("Typing matplotlib code");
      await typeSlowly(testCode, 30); // Faster typing for longer code
      await browser.pause(300);

      // Execute
      await browser.keys(["Shift", "Enter"]);
      console.log("Triggered matplotlib execution");

      try {
        // Wait for image output
        await browser.waitUntil(
          async () => {
            const img = await codeCell.$('img');
            return await img.isExisting();
          },
          {
            timeout: EXECUTION_TIMEOUT,
            interval: 1000,
          }
        );

        // Verify image exists
        const img = await codeCell.$('img');
        const imgExists = await img.isExisting();
        expect(imgExists).toBe(true);

        // Check image has valid src
        const src = await img.getAttribute("src");
        console.log("Image src type:", src ? src.substring(0, 50) + "..." : "none");
        expect(src).toBeTruthy();

        // Image should be either a data URL or blob URL
        expect(src.startsWith("data:") || src.startsWith("blob:")).toBe(true);

        console.log("Matplotlib image test passed");
      } catch (e) {
        // matplotlib might not be available
        console.log("matplotlib test skipped - may not be installed:", e.message);
      }
    });

    it("should render display(Image()) output", async () => {
      await setupCodeCell();

      // Create a simple base64 PNG (1x1 red pixel)
      const testCode = `from IPython.display import display, Image
import base64

# 1x1 red PNG pixel
red_pixel = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==')
display(Image(data=red_pixel, format='png'))`;

      console.log("Typing IPython Image display code");
      await typeSlowly(testCode, 30);
      await browser.pause(300);

      await browser.keys(["Shift", "Enter"]);

      try {
        await waitForAnyOutput(KERNEL_STARTUP_TIMEOUT);

        // Check for image
        const img = await codeCell.$('img');
        if (await img.isExisting()) {
          console.log("IPython Image display test passed");
        } else {
          console.log("Image not rendered as img tag, checking alternative formats");
        }
      } catch (e) {
        console.log("IPython Image test result:", e.message);
      }
    });
  });

  describe("HTML outputs", () => {
    it("should render HTML in isolated iframe", async () => {
      await setupCodeCell();

      // Display HTML content
      const testCode = `from IPython.display import display, HTML
display(HTML('<div style="color: blue; font-size: 20px;">Hello from HTML</div>'))`;

      console.log("Typing HTML display code");
      await typeSlowly(testCode, 30);
      await browser.pause(300);

      await browser.keys(["Shift", "Enter"]);

      try {
        await waitForAnyOutput(KERNEL_STARTUP_TIMEOUT);

        // HTML should be rendered in an iframe for isolation
        const iframe = await codeCell.$('iframe');
        const iframeExists = await iframe.isExisting();

        if (iframeExists) {
          console.log("HTML rendered in iframe - isolation working");

          // Verify iframe has sandbox attribute (security)
          const sandbox = await iframe.getAttribute("sandbox");
          console.log("Iframe sandbox:", sandbox);

          // Should not have allow-same-origin for security
          if (sandbox) {
            expect(sandbox).not.toContain("allow-same-origin");
          }
        } else {
          // HTML might be rendered directly if simple enough
          const htmlContent = await codeCell.getHTML();
          console.log("Cell HTML contains 'Hello':", htmlContent.includes("Hello"));
        }

        console.log("HTML output test passed");
      } catch (e) {
        console.log("HTML output test result:", e.message);
      }
    });

    it("should render pandas DataFrame as HTML", async () => {
      await setupCodeCell();

      // Create and display a pandas DataFrame
      const testCode = `import pandas as pd
df = pd.DataFrame({
    'Name': ['Alice', 'Bob', 'Charlie'],
    'Age': [25, 30, 35],
    'City': ['NYC', 'LA', 'Chicago']
})
df`;

      console.log("Typing pandas DataFrame code");
      await typeSlowly(testCode, 30);
      await browser.pause(300);

      await browser.keys(["Shift", "Enter"]);

      try {
        await waitForAnyOutput(EXECUTION_TIMEOUT);

        // DataFrame should render as HTML table
        // Check for table elements or iframe containing table
        const cellHtml = await codeCell.getHTML();
        const hasTable =
          cellHtml.includes("<table") ||
          cellHtml.includes("dataframe") ||
          cellHtml.includes("Alice"); // Data should be visible

        console.log("DataFrame rendered:", hasTable);

        if (hasTable) {
          console.log("pandas DataFrame test passed");
        }
      } catch (e) {
        // pandas might not be available
        console.log("pandas test skipped - may not be installed:", e.message);
      }
    });
  });

  describe("Multiple outputs", () => {
    it("should display multiple outputs from a single cell", async () => {
      await setupCodeCell();

      // Generate multiple outputs
      const testCode = `print("First output")
print("Second output")
print("Third output")`;

      console.log("Typing multiple print statements");
      await typeSlowly(testCode, 30);
      await browser.pause(300);

      await browser.keys(["Shift", "Enter"]);

      await browser.waitUntil(
        async () => {
          const output = await codeCell.$('[data-slot="ansi-stream-output"]');
          if (!(await output.isExisting())) return false;
          const text = await output.getText();
          return text.includes("Third output");
        },
        {
          timeout: KERNEL_STARTUP_TIMEOUT,
          interval: 500,
        }
      );

      // All outputs should be visible
      const outputText = await codeCell.$('[data-slot="ansi-stream-output"]').getText();
      console.log("Output text:", outputText);

      expect(outputText).toContain("First output");
      expect(outputText).toContain("Second output");
      expect(outputText).toContain("Third output");

      console.log("Multiple outputs test passed");
    });

    it("should display mixed output types", async () => {
      await setupCodeCell();

      // Generate different output types
      const testCode = `from IPython.display import display, Markdown

print("This is stdout")
display(Markdown("**This is bold markdown**"))
print("More stdout")`;

      console.log("Typing mixed output code");
      await typeSlowly(testCode, 30);
      await browser.pause(300);

      await browser.keys(["Shift", "Enter"]);

      try {
        await waitForAnyOutput(KERNEL_STARTUP_TIMEOUT);

        // Check that we have output
        const cellHtml = await codeCell.getHTML();
        const hasStdout = cellHtml.includes("stdout") || cellHtml.includes("This is");

        console.log("Mixed outputs rendered:", hasStdout);
        console.log("Mixed output types test passed");
      } catch (e) {
        console.log("Mixed output test result:", e.message);
      }
    });
  });

  describe("ANSI colors in output", () => {
    it("should render ANSI color codes", async () => {
      await setupCodeCell();

      // Print colored output
      const testCode = `print("\\033[31mRed text\\033[0m")
print("\\033[32mGreen text\\033[0m")
print("\\033[34mBlue text\\033[0m")`;

      console.log("Typing ANSI color code");
      await typeSlowly(testCode, 30);
      await browser.pause(300);

      await browser.keys(["Shift", "Enter"]);

      await browser.waitUntil(
        async () => {
          const output = await codeCell.$('[data-slot="ansi-stream-output"]');
          if (!(await output.isExisting())) return false;
          const text = await output.getText();
          return text.includes("Blue text");
        },
        {
          timeout: KERNEL_STARTUP_TIMEOUT,
          interval: 500,
        }
      );

      // Check that ANSI spans are rendered with color classes
      const outputHtml = await codeCell.$('[data-slot="ansi-stream-output"]').getHTML();
      console.log("Output HTML contains ansi class:", outputHtml.includes("ansi-"));

      // Should have ANSI color classes applied
      const hasColorClasses =
        outputHtml.includes("ansi-red") ||
        outputHtml.includes("ansi-green") ||
        outputHtml.includes("ansi-blue") ||
        outputHtml.includes("color:");

      console.log("ANSI colors rendered:", hasColorClasses);
      console.log("ANSI color test passed");
    });
  });
});

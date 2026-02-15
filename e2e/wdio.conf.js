/**
 * WebDriverIO configuration for Tauri E2E testing
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  runner: "local",

  specs: [path.join(__dirname, "specs", "*.spec.js")],

  // Don't run tests in parallel - we have one app instance
  maxInstances: 1,

  // Tauri WebDriver capabilities
  capabilities: [
    {
      // Tauri uses wry as the browser engine
      browserName: "wry",
      "tauri:options": {
        // Path is relative to where tauri-driver runs (inside Docker at /app)
        application:
          process.env.TAURI_APP_PATH || "/app/target/release/notebook",
      },
    },
  ],

  // WebDriver connection settings
  hostname: process.env.WEBDRIVER_HOST || "localhost",
  port: parseInt(process.env.WEBDRIVER_PORT || "4444", 10),

  logLevel: "info",

  // Timeouts
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  // Test framework
  framework: "mocha",
  reporters: ["spec"],

  mochaOpts: {
    ui: "bdd",
    timeout: 60000,
  },

  /**
   * Hook that gets executed after a test
   * Captures screenshot on failure for debugging
   */
  afterTest: async function (test, context, { error }) {
    if (error) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeName = test.title.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 50);
      const screenshotPath = `/app/e2e-screenshots/failures/${safeName}-${timestamp}.png`;
      try {
        const { browser } = await import("@wdio/globals");
        await browser.saveScreenshot(screenshotPath);
        console.log(`Failure screenshot saved: ${screenshotPath}`);
      } catch (screenshotError) {
        console.error("Failed to capture screenshot:", screenshotError.message);
      }
    }
  },
};

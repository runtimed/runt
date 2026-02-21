/**
 * WebDriverIO configuration for Tauri E2E testing
 *
 * Supports two modes:
 *   1. Docker mode (default): Connects to tauri-driver inside a Docker container
 *      - pnpm test:e2e:docker
 *
 *   2. Native mode (macOS): Connects to the app's built-in WebDriver server
 *      - Build: cargo build --features webdriver-test -p notebook
 *      - Run:   ./target/debug/notebook --webdriver-port 4444
 *      - Test:  pnpm test:e2e:native
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Screenshot directory: configurable via env, defaults to ./e2e-screenshots
const SCREENSHOT_DIR =
  process.env.E2E_SCREENSHOT_DIR || path.join(__dirname, "..", "e2e-screenshots");
const SCREENSHOT_FAILURES_DIR = path.join(SCREENSHOT_DIR, "failures");

// Ensure screenshot directories exist
fs.mkdirSync(SCREENSHOT_FAILURES_DIR, { recursive: true });

// Specs that require a specific NOTEBOOK_PATH fixture — excluded from the default run
const FIXTURE_SPECS = [
  "pixi-env-detection.spec.js",
  "pyproject-startup.spec.js",
  "both-deps-panel.spec.js",
  "iframe-isolation.spec.js",
];

export const config = {
  runner: "local",

  specs: process.env.E2E_SPEC
    ? [path.resolve(process.env.E2E_SPEC)]
    : [path.join(__dirname, "specs", "*.spec.js")],

  // Auto-exclude fixture-specific specs from the default run
  exclude: process.env.E2E_SPEC
    ? []
    : FIXTURE_SPECS.map((s) => path.join(__dirname, "specs", s)),

  // Don't run tests in parallel - we have one app instance
  maxInstances: 1,

  // Tauri WebDriver capabilities
  capabilities: [
    {
      // Tauri uses wry as the browser engine
      browserName: "wry",
      "tauri:options": {
        // In Docker mode: path to the compiled binary (tauri-driver launches it)
        // In native mode: ignored (app is already running with --webdriver-port)
        application:
          process.env.TAURI_APP_PATH || "/app/target/release/notebook",
        // Pass notebook path as arg to open a specific fixture
        ...(process.env.NOTEBOOK_PATH ? { args: [process.env.NOTEBOOK_PATH] } : {}),
      },
    },
  ],

  // WebDriver connection settings
  hostname: process.env.WEBDRIVER_HOST || "localhost",
  port: parseInt(process.env.WEBDRIVER_PORT || "4444", 10),

  logLevel: "warn",

  // Timeouts
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  // Test framework
  framework: "mocha",
  reporters: ["spec"],

  mochaOpts: {
    ui: "bdd",
    timeout: 180000, // 3 minutes to handle kernel startup scenarios
  },

  /**
   * Hook that gets executed after a test
   * Captures screenshot on failure for debugging
   */
  afterTest: async function (test, context, { error }) {
    if (error) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeName = test.title.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 50);
      const screenshotPath = path.join(
        SCREENSHOT_FAILURES_DIR,
        `${safeName}-${timestamp}.png`
      );
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

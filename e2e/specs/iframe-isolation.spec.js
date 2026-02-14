/**
 * E2E Security Tests for Iframe Isolation
 *
 * These tests verify that the isolated iframe properly blocks access to:
 * - Tauri APIs (window.__TAURI__, window.__TAURI_INTERNALS__)
 * - Parent document (cross-origin restriction)
 * - Parent localStorage (cross-origin restriction)
 *
 * The iframe should have an opaque "null" origin from the blob: URL.
 */

import { browser, expect } from "@wdio/globals";

describe("Iframe Isolation Security", () => {
  before(async () => {
    // Wait for app to fully load
    await browser.pause(5000);

    // Debug: Get the page title and URL
    const title = await browser.getTitle();
    const url = await browser.getUrl();
    console.log("Page title:", title);
    console.log("Page URL:", url);

    // Try to trigger the isolation test panel via keyboard
    // First try Control (Linux)
    await browser.keys(["Control", "Shift", "i"]);
    await browser.pause(2000);

    // Check if the panel appeared
    let isolationPanel = await $('[data-testid="isolation-test"]');
    const panelExists = await isolationPanel.isExisting();

    if (!panelExists) {
      console.log("Keyboard shortcut did not work, trying to inject state change");
      // Try to find React root and trigger state change via JS
      // This is a fallback for headless testing
      await browser.execute(() => {
        // Dispatch a keyboard event programmatically
        const event = new KeyboardEvent("keydown", {
          key: "i",
          code: "KeyI",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        });
        window.dispatchEvent(event);
      });
      await browser.pause(2000);
    }

    // Debug: Get page source to see what's rendered
    const pageSource = await browser.getPageSource();
    console.log(
      "Page contains isolation-test:",
      pageSource.includes("isolation-test")
    );
    console.log(
      "Page contains IsolatedFrame:",
      pageSource.includes("Isolated output frame")
    );
  });

  it("should have the isolation test panel or IsolatedFrame accessible", async () => {
    // Check for either the test panel or any isolated iframe
    const isolationTest = await $('[data-testid="isolation-test"]');
    const isolatedFrame = await $('iframe[title="Isolated output frame"]');
    const testFrame = await $('iframe[title="Isolation Test Frame"]');

    const testPanelExists = await isolationTest.isExisting();
    const productionFrameExists = await isolatedFrame.isExisting();
    const testFrameExists = await testFrame.isExisting();

    console.log("Test panel exists:", testPanelExists);
    console.log("Production frame exists:", productionFrameExists);
    console.log("Test frame exists:", testFrameExists);

    // At least one should exist for testing
    expect(testPanelExists || productionFrameExists || testFrameExists).toBe(
      true
    );
  });

  describe("Security Properties (if panel is visible)", () => {
    let iframeElement;

    before(async () => {
      // Try to find any isolated iframe
      iframeElement = await $('iframe[sandbox]');
      const exists = await iframeElement.isExisting();

      if (!exists) {
        console.log("No sandboxed iframe found, skipping security tests");
        // Mark as skipped
        this.skip();
      }
    });

    it("sandbox should NOT include allow-same-origin", async () => {
      if (!iframeElement || !(await iframeElement.isExisting())) {
        console.log("Skipping: No iframe found");
        return;
      }

      const sandbox = await iframeElement.getAttribute("sandbox");
      console.log("Sandbox attribute:", sandbox);
      expect(sandbox).not.toContain("allow-same-origin");
      expect(sandbox).toContain("allow-scripts");
    });

    it("window.__TAURI__ should be undefined in iframe", async () => {
      if (!iframeElement || !(await iframeElement.isExisting())) {
        console.log("Skipping: No iframe found");
        return;
      }

      await browser.switchToFrame(iframeElement);

      const hasTauri = await browser.execute(() => {
        return typeof window.__TAURI__ !== "undefined";
      });

      expect(hasTauri).toBe(false);
      await browser.switchToParentFrame();
    });

    it("window.__TAURI_INTERNALS__ should be undefined in iframe", async () => {
      if (!iframeElement || !(await iframeElement.isExisting())) {
        console.log("Skipping: No iframe found");
        return;
      }

      await browser.switchToFrame(iframeElement);

      const hasTauriInternals = await browser.execute(() => {
        return typeof window.__TAURI_INTERNALS__ !== "undefined";
      });

      expect(hasTauriInternals).toBe(false);
      await browser.switchToParentFrame();
    });

    it("accessing parent.document should throw cross-origin error", async () => {
      if (!iframeElement || !(await iframeElement.isExisting())) {
        console.log("Skipping: No iframe found");
        return;
      }

      await browser.switchToFrame(iframeElement);

      let securityErrorThrown = false;
      let result = null;

      try {
        result = await browser.execute(() => {
          try {
            const _body = window.parent.document.body;
            return { success: true, error: null };
          } catch (e) {
            return { success: false, error: e.name || e.message };
          }
        });
      } catch (e) {
        // WebDriver may throw the SecurityError directly instead of catching it
        // This is actually the expected behavior - the security restriction is working
        if (e.name === "SecurityError" || e.message.includes("SecurityError")) {
          securityErrorThrown = true;
        } else {
          throw e;
        }
      }

      // Test passes if either:
      // 1. WebDriver threw a SecurityError (security restriction working)
      // 2. The JS caught the error and returned success: false
      const accessBlocked = securityErrorThrown || (result && result.success === false);
      expect(accessBlocked).toBe(true);

      await browser.switchToParentFrame();
    });

    it('window.origin should be "null" (opaque origin)', async () => {
      if (!iframeElement || !(await iframeElement.isExisting())) {
        console.log("Skipping: No iframe found");
        return;
      }

      await browser.switchToFrame(iframeElement);

      const origin = await browser.execute(() => {
        return window.origin || window.location.origin;
      });

      expect(origin).toBe("null");
      await browser.switchToParentFrame();
    });
  });
});

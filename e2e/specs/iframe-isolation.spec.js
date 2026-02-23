/**
 * E2E Security Tests: Iframe Isolation (Fixture)
 *
 * Opens a notebook with pre-populated HTML display_data output (9-html-output.ipynb).
 * The IsolatedFrame renders on load without needing a kernel, then the tests verify
 * that the iframe sandbox properly blocks Tauri API leakage and cross-origin access.
 *
 * Note: browser.switchToFrame() and browser.executeAsync() are not supported in
 * wry's built-in WebDriver. We test the iframe's internal state via the production
 * postMessage eval channel (frame-html.ts handles { type: "eval" } messages).
 * We use browser.execute() + browser.waitUntil() polling to work around the lack
 * of async script execution.
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/9-html-output.ipynb
 */

import { browser, expect } from "@wdio/globals";
import { waitForAppReady } from "../helpers.js";

/**
 * Execute code inside the isolated iframe via postMessage eval channel.
 * Uses synchronous browser.execute() + polling since wry doesn't support executeAsync.
 * Returns the eval_result payload: { success: boolean, result?: string, error?: string }
 */
async function evalInIframe(code, timeout = 10000) {
  // Step 1: Set up listener in parent and send eval message to iframe
  await browser.execute((code) => {
    window.__iframeEvalResult = undefined;
    window.__iframeEvalDone = false;

    window.addEventListener("message", function handler(event) {
      if (event.data && event.data.type === "eval_result") {
        window.__iframeEvalResult = event.data.payload;
        window.__iframeEvalDone = true;
        window.removeEventListener("message", handler);
      }
    });

    const iframe = document.querySelector(
      'iframe[title="Isolated output frame"]',
    );
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: "eval", payload: { code: code } },
        "*",
      );
    } else {
      window.__iframeEvalResult = { success: false, error: "iframe not found" };
      window.__iframeEvalDone = true;
    }
  }, code);

  // Step 2: Poll until result arrives
  await browser.waitUntil(
    async () => {
      return await browser.execute(() => window.__iframeEvalDone === true);
    },
    {
      timeout,
      interval: 100,
      timeoutMsg: `Iframe eval timed out for: ${code}`,
    },
  );

  // Step 3: Retrieve and clean up result
  const result = await browser.execute(() => {
    const r = window.__iframeEvalResult;
    delete window.__iframeEvalResult;
    delete window.__iframeEvalDone;
    return r;
  });

  return result;
}

describe("Iframe Isolation Security", () => {
  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());

    // The fixture notebook has pre-populated HTML display_data output,
    // so the IsolatedFrame renders on load without needing a kernel.
    await browser.waitUntil(
      async () => {
        const iframe = await $('iframe[title="Isolated output frame"]');
        return await iframe.isExisting();
      },
      {
        timeout: 30000,
        interval: 500,
        timeoutMsg: "Isolated output frame did not appear",
      },
    );
    console.log("IsolatedFrame found");
  });

  it("should render HTML output in a sandboxed iframe", async () => {
    const iframe = await $('iframe[title="Isolated output frame"]');
    const sandbox = await iframe.getAttribute("sandbox");
    console.log("Sandbox attribute:", sandbox);

    // Critical: allow-same-origin must NOT be present (would give iframe access to Tauri APIs)
    expect(sandbox).not.toContain("allow-same-origin");
    // allow-scripts is required for interactive content
    expect(sandbox).toContain("allow-scripts");
  });

  it("should not expose window.__TAURI__ inside iframe", async () => {
    const result = await evalInIframe("typeof window.__TAURI__");
    console.log("__TAURI__ type in iframe:", result);
    expect(result.success).toBe(true);
    expect(result.result).toBe("undefined");
  });

  it("should not expose window.__TAURI_INTERNALS__ inside iframe", async () => {
    const result = await evalInIframe("typeof window.__TAURI_INTERNALS__");
    console.log("__TAURI_INTERNALS__ type in iframe:", result);
    expect(result.success).toBe(true);
    expect(result.result).toBe("undefined");
  });

  it('should have opaque "null" origin from blob: URL', async () => {
    const result = await evalInIframe(
      "window.origin || window.location.origin",
    );
    console.log("Iframe origin:", result);
    expect(result.success).toBe(true);
    expect(result.result).toBe("null");
  });

  it("should block access to parent document (cross-origin)", async () => {
    const result = await evalInIframe(
      "try { window.parent.document.body; 'accessible' } catch(e) { 'blocked:' + e.name }",
    );
    console.log("Parent document access result:", result);
    expect(result.success).toBe(true);
    expect(result.result).toContain("blocked");
  });

  it("should block localStorage access (opaque origin)", async () => {
    const result = await evalInIframe(
      "try { window.localStorage.getItem('test'); 'accessible' } catch(e) { 'blocked:' + e.name }",
    );
    console.log("localStorage access result:", result);
    expect(result.success).toBe(true);
    expect(result.result).toContain("blocked");
  });
});

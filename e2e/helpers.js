/**
 * Shared E2E test helpers
 *
 * Provides smart wait functions that detect actual app/kernel readiness
 * instead of relying on arbitrary pauses.
 */

import { browser } from "@wdio/globals";

/**
 * Wait for the app to be fully loaded (toolbar visible).
 * Uses browser.execute() (executeScript) which goes through the JS bridge
 * directly, avoiding potential findElement timing issues.
 */
export async function waitForAppReady() {
  await browser.waitUntil(
    async () => {
      return await browser.execute(() => {
        return !!document.querySelector('[data-testid="notebook-toolbar"]');
      });
    },
    {
      timeout: 15000,
      interval: 300,
      timeoutMsg: "App not ready — toolbar not found within 15s",
    }
  );
}

/**
 * Wait for the kernel to reach idle or busy state.
 * Use this in specs that execute code — replaces both the 5000ms before()
 * pause AND the first kernel startup wait.
 */
export async function waitForKernelReady() {
  await waitForAppReady();
  await browser.waitUntil(
    async () => {
      const text = await browser.execute(() => {
        const el = document.querySelector(
          '[data-testid="notebook-toolbar"] .capitalize'
        );
        return el ? el.textContent.trim().toLowerCase() : "";
      });
      return text === "idle" || text === "busy";
    },
    { timeout: 30000, interval: 200, timeoutMsg: "Kernel not ready" }
  );
}

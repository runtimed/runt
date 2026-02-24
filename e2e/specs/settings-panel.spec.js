/**
 * E2E Test: Settings Panel (Fixture)
 *
 * Opens a vanilla notebook and tests the settings panel UI:
 * toggling the panel, switching themes (observing <html> class changes),
 * and verifying active button states for runtime and Python env settings.
 *
 * Daemon-independent: tests only observable DOM effects, not localStorage
 * or settings.json persistence. Works whether or not runtimed is running.
 *
 * Requires: NOTEBOOK_PATH=crates/notebook/fixtures/audit-test/1-vanilla.ipynb
 */

import { browser, expect } from "@wdio/globals";
import { waitForAppReady } from "../helpers.js";

describe("Settings Panel", () => {
  before(async () => {
    await waitForAppReady();
    console.log("Page title:", await browser.getTitle());
  });

  describe("Panel toggle", () => {
    it("should open settings panel when clicking gear button", async () => {
      // Settings panel should not be in DOM initially (Radix Collapsible unmounts content)
      const panelBefore = await browser.execute(() => {
        return !!document.querySelector('[data-testid="settings-panel"]');
      });
      expect(panelBefore).toBe(false);

      // Click the gear button
      const gearButton = await $('[aria-label="Settings"]');
      await gearButton.waitForClickable({ timeout: 5000 });
      await gearButton.click();

      // Wait for panel to mount in DOM
      await browser.waitUntil(
        async () => {
          return await browser.execute(() => {
            return !!document.querySelector('[data-testid="settings-panel"]');
          });
        },
        {
          timeout: 3000,
          interval: 100,
          timeoutMsg: "Settings panel did not open",
        },
      );

      console.log("Settings panel opened");
    });

    it("should show all three setting groups", async () => {
      const themeGroup = await $('[data-testid="settings-theme-group"]');
      expect(await themeGroup.isExisting()).toBe(true);

      const runtimeGroup = await $('[data-testid="settings-runtime-group"]');
      expect(await runtimeGroup.isExisting()).toBe(true);

      const pythonEnvGroup = await $(
        '[data-testid="settings-python-env-group"]',
      );
      expect(await pythonEnvGroup.isExisting()).toBe(true);

      console.log("All three setting groups visible");
    });

    it("should close settings panel when clicking gear again", async () => {
      const gearButton = await $('[aria-label="Settings"]');
      await gearButton.click();

      // Wait for panel to unmount from DOM
      await browser.waitUntil(
        async () => {
          return await browser.execute(() => {
            return !document.querySelector('[data-testid="settings-panel"]');
          });
        },
        {
          timeout: 3000,
          interval: 100,
          timeoutMsg: "Settings panel did not close",
        },
      );

      console.log("Settings panel closed");
    });
  });

  describe("Theme switching", () => {
    before(async () => {
      // Ensure panel is open for theme tests
      const panelExists = await browser.execute(() => {
        return !!document.querySelector('[data-testid="settings-panel"]');
      });
      if (!panelExists) {
        const gearButton = await $('[aria-label="Settings"]');
        await gearButton.click();
        await browser.waitUntil(
          async () => {
            return await browser.execute(() => {
              return !!document.querySelector('[data-testid="settings-panel"]');
            });
          },
          { timeout: 3000, interval: 100 },
        );
      }
    });

    it("should apply 'dark' class to <html> when clicking Dark", async () => {
      // Find and click the Dark button within the theme group
      const darkButton = await browser.execute(() => {
        const group = document.querySelector(
          '[data-testid="settings-theme-group"]',
        );
        const buttons = group?.querySelectorAll("button");
        for (const btn of buttons || []) {
          if (btn.textContent?.includes("Dark")) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      expect(darkButton).toBe(true);

      // Wait for DOM class to update
      await browser.waitUntil(
        async () => {
          return await browser.execute(() => {
            return document.documentElement.classList.contains("dark");
          });
        },
        {
          timeout: 2000,
          interval: 100,
          timeoutMsg: "<html> did not get 'dark' class",
        },
      );

      // Verify "light" is removed
      const hasLight = await browser.execute(() => {
        return document.documentElement.classList.contains("light");
      });
      expect(hasLight).toBe(false);

      console.log("Dark theme applied to <html>");
    });

    it("should apply 'light' class to <html> when clicking Light", async () => {
      const lightButton = await browser.execute(() => {
        const group = document.querySelector(
          '[data-testid="settings-theme-group"]',
        );
        const buttons = group?.querySelectorAll("button");
        for (const btn of buttons || []) {
          if (btn.textContent?.includes("Light")) {
            btn.click();
            return true;
          }
        }
        return false;
      });
      expect(lightButton).toBe(true);

      await browser.waitUntil(
        async () => {
          return await browser.execute(() => {
            return document.documentElement.classList.contains("light");
          });
        },
        {
          timeout: 2000,
          interval: 100,
          timeoutMsg: "<html> did not get 'light' class",
        },
      );

      const hasDark = await browser.execute(() => {
        return document.documentElement.classList.contains("dark");
      });
      expect(hasDark).toBe(false);

      console.log("Light theme applied to <html>");
    });
  });

  describe("Active button states", () => {
    before(async () => {
      // Ensure panel is open for button state tests (sibling describe blocks don't share before hooks)
      const panelExists = await browser.execute(() => {
        return !!document.querySelector('[data-testid="settings-panel"]');
      });
      if (!panelExists) {
        const gearButton = await $('[aria-label="Settings"]');
        await gearButton.click();
        await browser.waitUntil(
          async () => {
            return await browser.execute(() => {
              return !!document.querySelector('[data-testid="settings-panel"]');
            });
          },
          { timeout: 3000, interval: 100 },
        );
      }
    });

    it("should highlight the active theme button", async () => {
      // Click Light to ensure theme is set (don't rely on state from previous describe block)
      await browser.execute(() => {
        const group = document.querySelector(
          '[data-testid="settings-theme-group"]',
        );
        const buttons = group?.querySelectorAll("button");
        for (const btn of buttons || []) {
          if (btn.textContent?.includes("Light")) {
            btn.click();
            break;
          }
        }
      });

      // Wait for React re-render to propagate to button classes — on CI Linux
      // the HTML class update and button re-render can happen in separate frames.
      await browser.waitUntil(
        async () => {
          return await browser.execute(() => {
            const group = document.querySelector(
              '[data-testid="settings-theme-group"]',
            );
            const buttons = group?.querySelectorAll("button");
            for (const btn of buttons || []) {
              if (btn.textContent?.includes("Light")) {
                return btn.className.includes("shadow-sm");
              }
            }
            return false;
          });
        },
        {
          timeout: 3000,
          interval: 100,
          timeoutMsg:
            "Light button did not get active styling (shadow-sm) after theme switch",
        },
      );

      const activeClass = await browser.execute(() => {
        const group = document.querySelector(
          '[data-testid="settings-theme-group"]',
        );
        const buttons = group?.querySelectorAll("button");
        for (const btn of buttons || []) {
          if (btn.textContent?.includes("Light")) {
            return btn.className;
          }
        }
        return "";
      });

      expect(activeClass).toContain("bg-background");
      expect(activeClass).toContain("shadow-sm");
      console.log("Active theme button has correct styling");
    });

    it("should update active state when switching theme", async () => {
      // Click Dark
      await browser.execute(() => {
        const group = document.querySelector(
          '[data-testid="settings-theme-group"]',
        );
        const buttons = group?.querySelectorAll("button");
        for (const btn of buttons || []) {
          if (btn.textContent?.includes("Dark")) {
            btn.click();
            break;
          }
        }
      });

      // Wait for React re-render
      await browser.waitUntil(
        async () => {
          return await browser.execute(() => {
            return document.documentElement.classList.contains("dark");
          });
        },
        { timeout: 2000, interval: 100 },
      );

      // Wait for Dark button to get active styling
      await browser.waitUntil(
        async () => {
          return await browser.execute(() => {
            const group = document.querySelector(
              '[data-testid="settings-theme-group"]',
            );
            const buttons = group?.querySelectorAll("button");
            for (const btn of buttons || []) {
              if (btn.textContent?.includes("Dark")) {
                return btn.className.includes("shadow-sm");
              }
            }
            return false;
          });
        },
        { timeout: 3000, interval: 100 },
      );

      const darkClass = await browser.execute(() => {
        const group = document.querySelector(
          '[data-testid="settings-theme-group"]',
        );
        const buttons = group?.querySelectorAll("button");
        for (const btn of buttons || []) {
          if (btn.textContent?.includes("Dark")) return btn.className;
        }
        return "";
      });
      expect(darkClass).toContain("shadow-sm");

      // Light button should now be inactive
      const lightClass = await browser.execute(() => {
        const group = document.querySelector(
          '[data-testid="settings-theme-group"]',
        );
        const buttons = group?.querySelectorAll("button");
        for (const btn of buttons || []) {
          if (btn.textContent?.includes("Light")) return btn.className;
        }
        return "";
      });
      expect(lightClass).not.toContain("shadow-sm");

      console.log("Active button state switches correctly");
    });

    it("should show default runtime and python env selections", async () => {
      // Verify at least one runtime button is active (don't assert which — daemon may set it)
      const hasActiveRuntime = await browser.execute(() => {
        const group = document.querySelector(
          '[data-testid="settings-runtime-group"]',
        );
        const buttons = group?.querySelectorAll("button");
        return Array.from(buttons || []).some((btn) =>
          btn.className.includes("shadow-sm"),
        );
      });
      expect(hasActiveRuntime).toBe(true);

      // Verify at least one python env button is active
      const hasActivePythonEnv = await browser.execute(() => {
        const group = document.querySelector(
          '[data-testid="settings-python-env-group"]',
        );
        const buttons = group?.querySelectorAll("button");
        return Array.from(buttons || []).some((btn) =>
          btn.className.includes("shadow-sm"),
        );
      });
      expect(hasActivePythonEnv).toBe(true);

      console.log("Runtime and Python env groups have active selections");
    });
  });
});

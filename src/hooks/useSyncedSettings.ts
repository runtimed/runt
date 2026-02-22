import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Theme } from "@tauri-apps/api/window";

export type ThemeMode = "light" | "dark" | "system";

interface SyncedSettings {
  theme: string;
  default_runtime: string;
  default_python_env: string;
}

function resolveTheme(theme: ThemeMode): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme;
}

function applyThemeToDOM(resolved: "light" | "dark") {
  const html = document.documentElement;
  if (resolved === "dark") {
    html.classList.add("dark");
    html.classList.remove("light");
  } else {
    html.classList.remove("dark");
    html.classList.add("light");
  }
}

async function syncNativeWindowTheme(theme: ThemeMode): Promise<void> {
  try {
    const tauriTheme: Theme | null = theme === "system" ? null : theme;
    await getCurrentWindow().setTheme(tauriTheme);
  } catch {
    // Silently fail if not in Tauri context
  }
}

function isValidTheme(value: string): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Hook for theme that syncs across all notebook windows via runtimed.
 *
 * Uses the Automerge-backed settings sync in runtimed to keep theme
 * consistent across all open notebook windows. Falls back to localStorage
 * if the daemon is unavailable (e.g., in the sidecar viewer).
 */
export function useSyncedTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    // Start with localStorage value for instant render (no flash)
    try {
      const stored = localStorage.getItem("notebook-theme");
      if (stored && isValidTheme(stored)) return stored;
    } catch {
      // ignore
    }
    return "system";
  });

  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    resolveTheme(theme),
  );

  // Load initial settings from daemon
  useEffect(() => {
    invoke<SyncedSettings>("get_synced_settings")
      .then((settings) => {
        if (isValidTheme(settings.theme)) {
          setThemeState(settings.theme);
          // Also update localStorage as a cache for next startup
          try {
            localStorage.setItem("notebook-theme", settings.theme);
          } catch {
            // ignore
          }
        }
      })
      .catch(() => {
        // Daemon unavailable, stick with localStorage value
      });
  }, []);

  // Listen for cross-window settings changes via Tauri events
  useEffect(() => {
    const unlisten = listen<SyncedSettings>("settings:changed", (event) => {
      const newTheme = event.payload.theme;
      if (isValidTheme(newTheme)) {
        setThemeState(newTheme);
        try {
          localStorage.setItem("notebook-theme", newTheme);
        } catch {
          // ignore
        }
      }
    });
    return () => {
      unlisten.then((u) => u());
    };
  }, []);

  // Apply theme to DOM and native window
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    applyThemeToDOM(resolved);
    syncNativeWindowTheme(theme);

    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const newResolved = resolveTheme("system");
      setResolvedTheme(newResolved);
      applyThemeToDOM(newResolved);
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme);

    // Update localStorage as cache
    try {
      localStorage.setItem("notebook-theme", newTheme);
    } catch {
      // ignore
    }

    // Push to daemon for cross-window sync
    invoke("set_synced_setting", { key: "theme", value: newTheme }).catch(
      () => {
        // Daemon unavailable — localStorage is already updated
      },
    );
  }, []);

  return { theme, setTheme, resolvedTheme };
}

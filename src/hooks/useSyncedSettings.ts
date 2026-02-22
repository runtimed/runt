import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Theme } from "@tauri-apps/api/window";

export type ThemeMode = "light" | "dark" | "system";
export type RuntimeMode = "python" | "deno";
export type PythonEnvMode = "uv" | "conda";

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

function isValidRuntime(value: string): value is RuntimeMode {
  return value === "python" || value === "deno";
}

function isValidPythonEnv(value: string): value is PythonEnvMode {
  return value === "uv" || value === "conda";
}

function getStored<T extends string>(key: string, validate: (v: string) => v is T): T | null {
  try {
    const stored = localStorage.getItem(key);
    if (stored && validate(stored)) return stored;
  } catch {
    // ignore
  }
  return null;
}

function setStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

/**
 * Hook for all synced settings across notebook windows via runtimed.
 *
 * Reads from the Automerge-backed settings sync daemon on mount,
 * listens for cross-window changes, and falls back to localStorage
 * when the daemon is unavailable.
 */
export function useSyncedSettings() {
  const [theme, setThemeState] = useState<ThemeMode>(
    () => getStored("notebook-theme", isValidTheme) ?? "system",
  );
  const [defaultRuntime, setDefaultRuntimeState] = useState<RuntimeMode>(
    () => getStored("notebook-default-runtime", isValidRuntime) ?? "python",
  );
  const [defaultPythonEnv, setDefaultPythonEnvState] = useState<PythonEnvMode>(
    () => getStored("notebook-default-python-env", isValidPythonEnv) ?? "uv",
  );

  // Load initial settings from daemon
  useEffect(() => {
    invoke<SyncedSettings>("get_synced_settings")
      .then((settings) => {
        if (isValidTheme(settings.theme)) {
          setThemeState(settings.theme);
          setStored("notebook-theme", settings.theme);
        }
        if (isValidRuntime(settings.default_runtime)) {
          setDefaultRuntimeState(settings.default_runtime);
          setStored("notebook-default-runtime", settings.default_runtime);
        }
        if (isValidPythonEnv(settings.default_python_env)) {
          setDefaultPythonEnvState(settings.default_python_env);
          setStored("notebook-default-python-env", settings.default_python_env);
        }
      })
      .catch(() => {
        // Daemon unavailable, stick with localStorage values
      });
  }, []);

  // Listen for cross-window settings changes via Tauri events
  useEffect(() => {
    const unlisten = listen<SyncedSettings>("settings:changed", (event) => {
      const { theme: newTheme, default_runtime, default_python_env } =
        event.payload;
      if (isValidTheme(newTheme)) {
        setThemeState(newTheme);
        setStored("notebook-theme", newTheme);
      }
      if (isValidRuntime(default_runtime)) {
        setDefaultRuntimeState(default_runtime);
        setStored("notebook-default-runtime", default_runtime);
      }
      if (isValidPythonEnv(default_python_env)) {
        setDefaultPythonEnvState(default_python_env);
        setStored("notebook-default-python-env", default_python_env);
      }
    });
    return () => {
      unlisten.then((u) => u());
    };
  }, []);

  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme);
    setStored("notebook-theme", newTheme);
    invoke("set_synced_setting", { key: "theme", value: newTheme }).catch(
      () => {},
    );
  }, []);

  const setDefaultRuntime = useCallback((newRuntime: RuntimeMode) => {
    setDefaultRuntimeState(newRuntime);
    setStored("notebook-default-runtime", newRuntime);
    invoke("set_synced_setting", {
      key: "default_runtime",
      value: newRuntime,
    }).catch(() => {});
  }, []);

  const setDefaultPythonEnv = useCallback((newEnv: PythonEnvMode) => {
    setDefaultPythonEnvState(newEnv);
    setStored("notebook-default-python-env", newEnv);
    invoke("set_synced_setting", {
      key: "default_python_env",
      value: newEnv,
    }).catch(() => {});
  }, []);

  return {
    theme,
    setTheme,
    defaultRuntime,
    setDefaultRuntime,
    defaultPythonEnv,
    setDefaultPythonEnv,
  };
}

/**
 * Hook for theme that syncs across all notebook windows via runtimed.
 *
 * Wraps useSyncedSettings() and adds DOM/native window theme application.
 * Falls back to localStorage if the daemon is unavailable.
 */
export function useSyncedTheme() {
  const { theme, setTheme } = useSyncedSettings();

  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() =>
    resolveTheme(theme),
  );

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

  return { theme, setTheme, resolvedTheme };
}

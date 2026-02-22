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
  default_uv_packages: string;
  default_conda_packages: string;
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

/**
 * Read a theme value from localStorage.
 *
 * localStorage is ONLY used for the theme setting to avoid a flash of
 * unstyled content (FOUC) on startup. All other settings initialize from
 * defaults and wait for the daemon to provide the authoritative value.
 */
function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem("notebook-theme");
    if (stored && isValidTheme(stored)) return stored;
  } catch {
    // ignore
  }
  return "system";
}

function setStoredTheme(value: ThemeMode) {
  try {
    localStorage.setItem("notebook-theme", value);
  } catch {
    // ignore
  }
}

/**
 * Hook for all synced settings across notebook windows via runtimed.
 *
 * The daemon (Automerge doc) is the source of truth. On mount, we fetch
 * the current settings from the daemon and listen for cross-window changes.
 *
 * localStorage is only used for theme to avoid FOUC. All other settings
 * initialize from defaults and are overwritten once the daemon responds.
 */
export function useSyncedSettings() {
  // Theme uses localStorage to avoid flash of wrong theme on startup
  const [theme, setThemeState] = useState<ThemeMode>(getStoredTheme);
  // All other settings use defaults — daemon is the source of truth
  const [defaultRuntime, setDefaultRuntimeState] =
    useState<RuntimeMode>("python");
  const [defaultPythonEnv, setDefaultPythonEnvState] =
    useState<PythonEnvMode>("uv");
  const [defaultUvPackages, setDefaultUvPackagesState] = useState("");
  const [defaultCondaPackages, setDefaultCondaPackagesState] = useState("");

  // Load initial settings from daemon
  useEffect(() => {
    invoke<SyncedSettings>("get_synced_settings")
      .then((settings) => {
        if (isValidTheme(settings.theme)) {
          setThemeState(settings.theme);
          setStoredTheme(settings.theme);
        }
        if (isValidRuntime(settings.default_runtime)) {
          setDefaultRuntimeState(settings.default_runtime);
        }
        if (isValidPythonEnv(settings.default_python_env)) {
          setDefaultPythonEnvState(settings.default_python_env);
        }
        if (typeof settings.default_uv_packages === "string") {
          setDefaultUvPackagesState(settings.default_uv_packages);
        }
        if (typeof settings.default_conda_packages === "string") {
          setDefaultCondaPackagesState(settings.default_conda_packages);
        }
      })
      .catch(() => {
        // Daemon unavailable — defaults are fine
      });
  }, []);

  // Listen for cross-window settings changes via Tauri events
  useEffect(() => {
    const unlisten = listen<SyncedSettings>("settings:changed", (event) => {
      const { theme: newTheme, default_runtime, default_python_env } =
        event.payload;
      if (isValidTheme(newTheme)) {
        setThemeState(newTheme);
        setStoredTheme(newTheme);
      }
      if (isValidRuntime(default_runtime)) {
        setDefaultRuntimeState(default_runtime);
      }
      if (isValidPythonEnv(default_python_env)) {
        setDefaultPythonEnvState(default_python_env);
      }
      if (typeof event.payload.default_uv_packages === "string") {
        setDefaultUvPackagesState(event.payload.default_uv_packages);
      }
      if (typeof event.payload.default_conda_packages === "string") {
        setDefaultCondaPackagesState(event.payload.default_conda_packages);
      }
    });
    return () => {
      unlisten.then((u) => u());
    };
  }, []);

  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme);
    setStoredTheme(newTheme);
    invoke("set_synced_setting", { key: "theme", value: newTheme }).catch(
      () => {},
    );
  }, []);

  const setDefaultRuntime = useCallback((newRuntime: RuntimeMode) => {
    setDefaultRuntimeState(newRuntime);
    invoke("set_synced_setting", {
      key: "default_runtime",
      value: newRuntime,
    }).catch(() => {});
  }, []);

  const setDefaultPythonEnv = useCallback((newEnv: PythonEnvMode) => {
    setDefaultPythonEnvState(newEnv);
    invoke("set_synced_setting", {
      key: "default_python_env",
      value: newEnv,
    }).catch(() => {});
  }, []);

  const setDefaultUvPackages = useCallback((packages: string) => {
    setDefaultUvPackagesState(packages);
    invoke("set_synced_setting", {
      key: "default_uv_packages",
      value: packages,
    }).catch(() => {});
  }, []);

  const setDefaultCondaPackages = useCallback((packages: string) => {
    setDefaultCondaPackagesState(packages);
    invoke("set_synced_setting", {
      key: "default_conda_packages",
      value: packages,
    }).catch(() => {});
  }, []);

  return {
    theme,
    setTheme,
    defaultRuntime,
    setDefaultRuntime,
    defaultPythonEnv,
    setDefaultPythonEnv,
    defaultUvPackages,
    setDefaultUvPackages,
    defaultCondaPackages,
    setDefaultCondaPackages,
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

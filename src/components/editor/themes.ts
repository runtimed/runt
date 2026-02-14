import type { Extension } from "@codemirror/state";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";

// Re-export generic theme utilities from shared module
export {
  type ThemeMode,
  prefersDarkMode,
  documentHasDarkMode,
  isDarkMode,
} from "@/components/themes";

import { isDarkMode } from "@/components/themes";

/**
 * Light theme - GitHub Light
 */
export const lightTheme: Extension = githubLight;

/**
 * Dark theme - GitHub Dark
 */
export const darkTheme: Extension = githubDark;

/**
 * Get the appropriate theme extension based on mode
 */
export function getTheme(mode: "light" | "dark" | "system"): Extension {
  if (mode === "light") {
    return lightTheme;
  }
  if (mode === "dark") {
    return darkTheme;
  }
  // System mode - detect from media query
  if (typeof window !== "undefined") {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    return prefersDark ? darkTheme : lightTheme;
  }
  // SSR fallback
  return lightTheme;
}

/**
 * Get the current theme based on automatic detection
 * Checks document class, color-scheme, data-theme attribute, and system preference
 */
export function getAutoTheme(): Extension {
  return isDarkMode() ? darkTheme : lightTheme;
}

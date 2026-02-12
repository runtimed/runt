import type { Extension } from "@codemirror/state";
import { githubDark, githubLight } from "@uiw/codemirror-theme-github";

/**
 * Theme mode options
 */
export type ThemeMode = "light" | "dark" | "system";

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
export function getTheme(mode: ThemeMode): Extension {
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
 * Check if the current environment prefers dark mode via system preference
 */
export function prefersDarkMode(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Check if the document has dark mode enabled
 * Checks multiple common patterns:
 * - class="dark" or class="... dark ..." on <html>
 * - color-scheme: dark on <html>
 * - data-theme="dark" attribute
 */
export function documentHasDarkMode(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const html = document.documentElement;

  // Check for 'dark' in classList (Tailwind / fumadocs pattern)
  if (html.classList.contains("dark")) {
    return true;
  }

  // Check color-scheme style
  const colorScheme =
    html.style.colorScheme || getComputedStyle(html).colorScheme;
  if (colorScheme === "dark") {
    return true;
  }

  // Check data-theme attribute (another common pattern)
  if (html.getAttribute("data-theme") === "dark") {
    return true;
  }

  // Check data-mode attribute
  if (html.getAttribute("data-mode") === "dark") {
    return true;
  }

  return false;
}

/**
 * Detect dark mode from either document state or system preference
 * Prioritizes document state (site-level toggle) over system preference
 */
export function isDarkMode(): boolean {
  // Check document state first (site-level dark mode toggle)
  if (documentHasDarkMode()) {
    return true;
  }

  // Check if document explicitly has light mode set
  if (typeof document !== "undefined") {
    const html = document.documentElement;

    // If 'light' class is present, respect it
    if (html.classList.contains("light")) {
      return false;
    }

    // If color-scheme is explicitly light, respect it
    const colorScheme =
      html.style.colorScheme || getComputedStyle(html).colorScheme;
    if (colorScheme === "light") {
      return false;
    }
  }

  // Fall back to system preference
  return prefersDarkMode();
}

/**
 * Get the current theme based on automatic detection
 * Checks document class, color-scheme, data-theme attribute, and system preference
 */
export function getAutoTheme(): Extension {
  return isDarkMode() ? darkTheme : lightTheme;
}

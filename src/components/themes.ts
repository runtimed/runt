/**
 * Generic theme detection utilities
 *
 * These functions detect dark/light mode from document state or system preferences.
 * Used by various components (markdown output, code editor, etc.) for theme-aware rendering.
 */

/**
 * Theme mode options
 */
export type ThemeMode = "light" | "dark" | "system";

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

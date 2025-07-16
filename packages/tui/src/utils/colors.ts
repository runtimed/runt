/**
 * Color scheme for the notebook TUI
 * Based on common terminal colors with semantic meaning
 */

export const Colors = {
  // Base colors
  Foreground: "white",
  Background: "black",
  Gray: "gray",

  // Accent colors
  AccentBlue: "blue",
  AccentPurple: "magenta",
  AccentCyan: "cyan",
  AccentGreen: "green",
  AccentYellow: "yellow",
  AccentRed: "red",

  // Cell type colors (matching main Runt UI)
  CellType: {
    code: "gray",
    ai: "magenta",
    markdown: "yellow",
    sql: "blue",
    raw: "gray",
  },

  // Output type colors
  Output: {
    terminal: "white",
    error: "red",
    multimedia: "cyan",
    markdown: "yellow",
    execute_result: "green",
    stream: "white",
  },

  // UI element colors
  UI: {
    border: "gray",
    title: "green",
    badge: "cyan",
    metadata: "gray",
    highlight: "yellow",
    success: "green",
    warning: "yellow",
    error: "red",
  },

  // Syntax highlighting colors
  Syntax: {
    keyword: "blue",
    string: "green",
    number: "yellow",
    comment: "gray",
    function: "cyan",
    variable: "white",
    builtin: "magenta",
    type: "blue",
    literal: "yellow",
    operator: "white",
    punctuation: "white",
  },
} as const;

export type ColorName = keyof typeof Colors;

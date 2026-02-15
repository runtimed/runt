export interface GutterColorConfig {
  ribbon: {
    default: string;
    focused: string;
  };
  outputRibbon: {
    default: string;
    focused: string;
  };
  background: {
    focused: string;
  };
}

/**
 * Default gutter colors for built-in cell types.
 * Colors are designed to match the existing CellTypeButton color scheme.
 */
export const defaultGutterColors: Record<string, GutterColorConfig> = {
  code: {
    ribbon: {
      default: "bg-gray-200 dark:bg-gray-700",
      focused: "bg-sky-400 dark:bg-sky-600",
    },
    outputRibbon: {
      default: "bg-gradient-to-b from-gray-200/60 to-gray-200 dark:from-gray-700/60 dark:to-gray-700",
      focused: "bg-gradient-to-b from-sky-400/60 to-sky-400 dark:from-sky-600/60 dark:to-sky-600",
    },
    background: {
      focused: "bg-sky-50/20 dark:bg-sky-900/10",
    },
  },
  markdown: {
    ribbon: {
      default: "bg-gray-200 dark:bg-gray-700",
      focused: "bg-emerald-400 dark:bg-emerald-600",
    },
    outputRibbon: {
      default: "bg-gradient-to-b from-gray-200/60 to-gray-200 dark:from-gray-700/60 dark:to-gray-700",
      focused: "bg-gradient-to-b from-emerald-400/60 to-emerald-400 dark:from-emerald-600/60 dark:to-emerald-600",
    },
    background: {
      focused: "bg-emerald-50/20 dark:bg-emerald-900/10",
    },
  },
  sql: {
    ribbon: {
      default: "bg-blue-200 dark:bg-blue-800",
      focused: "bg-blue-400 dark:bg-blue-600",
    },
    outputRibbon: {
      default: "bg-gradient-to-b from-blue-200/60 to-blue-200 dark:from-blue-800/60 dark:to-blue-800",
      focused: "bg-gradient-to-b from-blue-400/60 to-blue-400 dark:from-blue-600/60 dark:to-blue-600",
    },
    background: {
      focused: "bg-blue-50/50 dark:bg-blue-900/30",
    },
  },
  ai: {
    ribbon: {
      default: "bg-purple-200 dark:bg-purple-800",
      focused: "bg-purple-400 dark:bg-purple-600",
    },
    outputRibbon: {
      default: "bg-gradient-to-b from-purple-200/60 to-purple-200 dark:from-purple-800/60 dark:to-purple-800",
      focused: "bg-gradient-to-b from-purple-400/60 to-purple-400 dark:from-purple-600/60 dark:to-purple-600",
    },
    background: {
      focused: "bg-purple-50/50 dark:bg-purple-900/30",
    },
  },
  raw: {
    ribbon: {
      default: "bg-rose-200 dark:bg-rose-800",
      focused: "bg-rose-400 dark:bg-rose-600",
    },
    outputRibbon: {
      default: "bg-gradient-to-b from-rose-200/60 to-rose-200 dark:from-rose-800/60 dark:to-rose-800",
      focused: "bg-gradient-to-b from-rose-400/60 to-rose-400 dark:from-rose-600/60 dark:to-rose-600",
    },
    background: {
      focused: "bg-rose-50/50 dark:bg-rose-900/30",
    },
  },
};

/**
 * Fallback colors for unknown cell types.
 * Uses neutral gray styling.
 */
export const fallbackGutterColors: GutterColorConfig = {
  ribbon: {
    default: "bg-gray-200 dark:bg-gray-700",
    focused: "bg-gray-400 dark:bg-gray-500",
  },
  outputRibbon: {
    default: "bg-gradient-to-b from-gray-200/60 to-gray-200 dark:from-gray-700/60 dark:to-gray-700",
    focused: "bg-gradient-to-b from-gray-400/60 to-gray-400 dark:from-gray-500/60 dark:to-gray-500",
  },
  background: {
    focused: "bg-gray-50/50 dark:bg-gray-900/30",
  },
};

/**
 * Get gutter colors for a cell type.
 * Falls back to neutral gray for unknown types.
 *
 * @param cellType - The cell type to get colors for
 * @param customColors - Optional custom color overrides
 */
export function getGutterColors(
  cellType: string,
  customColors?: Record<string, GutterColorConfig>,
): GutterColorConfig {
  // Check custom colors first
  if (customColors?.[cellType]) {
    return customColors[cellType];
  }
  // Then check defaults
  if (defaultGutterColors[cellType]) {
    return defaultGutterColors[cellType];
  }
  // Fall back to neutral
  return fallbackGutterColors;
}

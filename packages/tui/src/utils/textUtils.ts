/**
 * Utility functions for text measurement and formatting in terminal environments
 */

/**
 * Estimates the height (number of lines) that a text string will occupy
 * when rendered in a terminal with the given width, accounting for word wrapping.
 *
 * @param text - The text to measure
 * @param terminalWidth - The width of the terminal in characters
 * @returns The estimated number of lines the text will occupy
 */
export function estimateTextHeight(
  text: string,
  terminalWidth: number,
): number {
  if (!text || text.length === 0) {
    return 0;
  }

  // Ensure we have a reasonable minimum width
  const width = Math.max(terminalWidth, 10);

  // Split by existing newlines first
  const lines = text.split("\n");
  let totalLines = 0;

  for (const line of lines) {
    if (line.length === 0) {
      // Empty line still takes up one line
      totalLines += 1;
    } else if (line.length <= width) {
      // Line fits within terminal width
      totalLines += 1;
    } else {
      // Line needs to be wrapped
      // Simple word wrapping: split long lines into chunks
      let remaining = line;
      while (remaining.length > 0) {
        if (remaining.length <= width) {
          totalLines += 1;
          break;
        }

        // Find the best break point (prefer breaking at spaces)
        let breakPoint = width;
        const spaceIndex = remaining.lastIndexOf(" ", width);

        if (spaceIndex > width * 0.5) {
          // Use space break if it's not too far back (more than halfway)
          breakPoint = spaceIndex;
        }

        remaining = remaining.slice(breakPoint).trimStart();
        totalLines += 1;
      }
    }
  }

  return totalLines;
}

/**
 * Estimates the width (number of characters) that a text string will occupy
 * accounting for special characters and control sequences.
 *
 * @param text - The text to measure
 * @returns The estimated width in characters
 */
export function estimateTextWidth(text: string): number {
  if (!text) {
    return 0;
  }

  // Simple implementation - just return the length
  // In a more sophisticated version, this could handle:
  // - ANSI escape sequences
  // - Unicode width characters
  // - Tab characters
  return text.length;
}

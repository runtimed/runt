/**
 * Terminal-friendly representation selector utility
 * Selects the most appropriate representation for terminal display
 */

import type { MediaContainer } from "@runt/schema";

export interface RepresentationResult {
  mimeType: string;
  container: MediaContainer;
}

/**
 * Terminal-friendly MIME type preferences
 * Prioritizes text-based formats that render well in terminals
 */
const TERMINAL_PREFERRED_MIME_TYPES = [
  // Text formats (highest priority for terminal)
  "text/markdown",
  "application/json",
  "text/plain",

  // Structured data formats
  "application/vnd.dataresource+json",
  "application/geo+json",

  // Rich text (if needed)
  "text/latex",

  // Interactive/visual content (lowest priority - will show as unsupported)
  "text/html",
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/gif",
  "application/javascript",
  "application/vnd.plotly.v1+json",
  "application/vnd.vegalite.v6+json",
  "application/vnd.vegalite.v5+json",
  "application/vnd.vegalite.v4+json",
  "application/vnd.vegalite.v3+json",
  "application/vnd.vegalite.v2+json",
  "application/vnd.vega.v5+json",
  "application/vnd.vega.v4+json",
  "application/vnd.vega.v3+json",
  "application/vnd.jupyter.widget-view+json",
  "application/vnd.jupyter.widget-state+json",
  "application/vdom.v1+json",
] as const;

/**
 * Selects the best representation for terminal display
 * @param representations - Object mapping MIME types to media containers
 * @param preferredMimeTypes - Optional custom preference order
 * @returns The selected representation or null if none found
 */
export function selectTerminalRepresentation(
  representations: Record<string, MediaContainer>,
  preferredMimeTypes: readonly string[] = TERMINAL_PREFERRED_MIME_TYPES,
): RepresentationResult | null {
  // First pass: try preferred order
  for (const mimeType of preferredMimeTypes) {
    if (representations[mimeType]) {
      return {
        mimeType,
        container: representations[mimeType],
      };
    }
  }

  // Second pass: fallback to any available representation
  const availableTypes = Object.keys(representations);
  if (availableTypes.length > 0) {
    const fallbackType = availableTypes[0];
    if (fallbackType && representations[fallbackType]) {
      return {
        mimeType: fallbackType,
        container: representations[fallbackType],
      };
    }
  }

  return null;
}

/**
 * Extracts data from a media container
 * @param container - The media container
 * @returns The extracted data
 */
export function extractMediaData(container: MediaContainer): unknown {
  if (container.type === "inline") {
    return container.data;
  } else if (container.type === "artifact") {
    // For artifacts, we'd need to fetch from storage
    // For now, return a placeholder
    return `[Artifact: ${container.artifactId}]`;
  }
  return null;
}

/**
 * Converts multimedia output to terminal-friendly format
 * @param output - The multimedia output from LiveStore
 * @returns Processed data for terminal display
 */
export function processMultimediaOutput(output: {
  data: unknown;
  mimeType?: string;
  representations?: Record<string, MediaContainer>;
}) {
  // If representations exist, use them
  if (output.representations) {
    const selected = selectTerminalRepresentation(output.representations);
    if (selected) {
      return {
        mimeType: selected.mimeType,
        data: extractMediaData(selected.container),
      };
    }
  }

  // Fallback to direct data with mimeType
  return {
    mimeType: output.mimeType || "application/octet-stream",
    data: output.data,
  };
}

/**
 * Checks if a MIME type is terminal-friendly
 * @param mimeType - The MIME type to check
 * @returns True if the type renders well in terminals
 */
export function isTerminalFriendly(mimeType: string): boolean {
  const terminalFriendlyTypes = [
    "text/markdown",
    "application/json",
    "text/plain",
    "application/vnd.dataresource+json",
    "application/geo+json",
    "text/latex",
  ];

  return terminalFriendlyTypes.includes(mimeType);
}

/**
 * Gets a user-friendly description of unsupported content
 * @param mimeType - The MIME type
 * @returns A descriptive message for unsupported content
 */
export function getUnsupportedContentMessage(mimeType: string): string {
  if (mimeType.startsWith("image/")) {
    return `📷 Image (${mimeType.split("/")[1]}) - not displayable in terminal`;
  }

  if (mimeType.startsWith("application/vnd.plotly")) {
    return "📊 Interactive Plotly chart - not displayable in terminal";
  }

  if (mimeType.startsWith("application/vnd.vega")) {
    return "📊 Vega/Vega-Lite chart - not displayable in terminal";
  }

  if (mimeType === "text/html") {
    return "🌐 HTML content - not displayable in terminal";
  }

  if (mimeType === "application/javascript") {
    return "⚡ JavaScript content - not executable in terminal";
  }

  if (mimeType.includes("jupyter.widget")) {
    return "🔧 Jupyter widget - not displayable in terminal";
  }

  return `📎 Content (${mimeType}) - not displayable in terminal`;
}

/**
 * Determines if content should be rendered as JSON with syntax highlighting
 * @param data - The data to check
 * @param mimeType - The MIME type of the data
 * @returns True if content should be rendered as JSON
 */
export function shouldRenderAsJson(data: unknown, mimeType?: string): boolean {
  // Explicit JSON MIME types
  if (mimeType === "application/json" || mimeType?.includes("json")) {
    return true;
  }

  // If it's already a string, don't treat as JSON unless explicitly JSON MIME type
  if (typeof data === "string") {
    return false;
  }

  // If it's an object or array, render as JSON
  if (typeof data === "object" && data !== null) {
    return true;
  }

  return false;
}

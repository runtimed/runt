/**
 * AI-specific media utilities for converting rich output to LLM-friendly formats
 *
 * This module provides utilities for converting Jupyter-style rich output
 * into formats that work well with Large Language Models, while preserving
 * the flexibility to extend with custom AI-specific transformations.
 */

import { IMAGE_MIME_TYPES, type MediaContainer } from "@runt/schema";

/**
 * Media bundle interface for AI processing
 * Maps MIME types to their content representations
 */
export interface AIMediaBundle {
  [mimeType: string]: unknown;
}

/**
 * Rich output data structure used in notebook outputs
 */
export interface RichOutputData {
  [mimeType: string]: MediaContainer;
}

/**
 * Convert rich notebook output to AI-friendly formats
 *
 * AI models work better with certain formats:
 * - Markdown is more compact and structured than HTML
 * - JSON preserves data structure for reasoning
 * - Images work with vision-capable models
 * - Plain text provides universal fallback
 *
 * @example
 * ```typescript
 * const richOutput = {
 *   "text/html": { type: "inline", data: "<h1>Sales Report</h1>" },
 *   "text/markdown": { type: "inline", data: "# Sales Report" },
 *   "application/json": { type: "inline", data: { revenue: 10000 } }
 * };
 *
 * const aiBundle = toAIMediaBundle(richOutput);
 * // Prefers markdown over HTML, keeps JSON structure
 * ```
 */
export function toAIMediaBundle(richOutput: RichOutputData): AIMediaBundle {
  const result: AIMediaBundle = {};

  // Always include text/plain if available
  if (richOutput["text/plain"]) {
    const container = richOutput["text/plain"];
    if (container.type === "inline") {
      result["text/plain"] = container.data;
    }
  }

  // Prefer markdown over HTML for AI
  if (richOutput["text/markdown"]) {
    const container = richOutput["text/markdown"];
    if (container.type === "inline") {
      result["text/markdown"] = container.data;
    }
  } else if (richOutput["text/html"]) {
    const container = richOutput["text/html"];
    if (container.type === "inline" && typeof container.data === "string") {
      // Convert HTML to plain text for AI if no markdown available
      const plainFromHtml = container.data.replace(/<[^>]*>/g, "");
      if (!result["text/plain"]) {
        result["text/plain"] = plainFromHtml;
      }
    }
  }

  // Include JSON for structured data
  if (richOutput["application/json"]) {
    const container = richOutput["application/json"];
    if (container.type === "inline") {
      result["application/json"] = container.data;
    }
  }

  // Include images that some AI providers support
  for (const imageType of IMAGE_MIME_TYPES) {
    if (richOutput[imageType]) {
      const container = richOutput[imageType];
      if (container.type === "inline") {
        result[imageType] = container.data;
      }
    }
  }

  return result;
}

/**
 * Ensure every media bundle has text/plain for maximum AI compatibility
 *
 * Some AI providers only support text, and text/plain ensures your output
 * is never completely invisible to an AI system.
 *
 * @example
 * ```typescript
 * const bundle = { "text/html": "<b>Important data</b>" };
 * const withFallback = ensureTextPlainFallback(bundle);
 * // { "text/html": "<b>Important data</b>", "text/plain": "Important data" }
 * ```
 */
export function ensureTextPlainFallback(bundle: AIMediaBundle): AIMediaBundle {
  if (bundle["text/plain"]) {
    return bundle;
  }

  const result = { ...bundle };

  // Try to generate text/plain from other formats
  if (typeof result["text/html"] === "string") {
    // Strip HTML tags for plain text
    result["text/plain"] = result["text/html"].replace(/<[^>]*>/g, "");
  } else if (typeof result["text/markdown"] === "string") {
    // Markdown is readable as plain text
    result["text/plain"] = result["text/markdown"];
  } else {
    // Use first available string content
    const firstStringValue = Object.values(result).find(
      (value): value is string => typeof value === "string",
    );
    if (firstStringValue) {
      result["text/plain"] = firstStringValue;
    } else {
      // Last resort: JSON stringify first available content
      const firstEntry = Object.entries(result)[0];
      if (firstEntry && firstEntry[1] != null) {
        try {
          result["text/plain"] = JSON.stringify(firstEntry[1], null, 2);
        } catch {
          result["text/plain"] = String(firstEntry[1]);
        }
      } else {
        result["text/plain"] = "";
      }
    }
  }

  return result;
}

/**
 * Convert rich output data to a simplified format for AI context
 *
 * This function prioritizes content types that work well with LLMs:
 * 1. Markdown over HTML (better structure, less noise)
 * 2. Plain text as universal fallback
 * 3. JSON for structured data
 * 4. Images for vision-capable models
 *
 * Skips verbose formats like HTML with embedded CSS/JS.
 */
export function toAIContext(richOutput: RichOutputData): string {
  const aiBundle = toAIMediaBundle(richOutput);
  const withFallback = ensureTextPlainFallback(aiBundle);

  // Prioritize markdown for AI readability
  if (withFallback["text/markdown"]) {
    return String(withFallback["text/markdown"]);
  }

  // Fall back to plain text
  if (withFallback["text/plain"]) {
    return String(withFallback["text/plain"]);
  }

  // Last resort: JSON representation
  if (withFallback["application/json"]) {
    try {
      return JSON.stringify(withFallback["application/json"], null, 2);
    } catch {
      return String(withFallback["application/json"]);
    }
  }

  return "";
}

/**
 * Check if rich output contains visual content (images, plots, etc.)
 */
export function hasVisualContent(richOutput: RichOutputData): boolean {
  return IMAGE_MIME_TYPES.some((mimeType) =>
    richOutput[mimeType] && richOutput[mimeType].type === "inline"
  );
}

/**
 * Extract structured data from rich output for AI analysis
 */
export function extractStructuredData(richOutput: RichOutputData): unknown {
  if (richOutput["application/json"]) {
    const container = richOutput["application/json"];
    if (container.type === "inline") {
      return container.data;
    }
  }
  return null;
}

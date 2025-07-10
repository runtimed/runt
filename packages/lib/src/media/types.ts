/**
 * # Media Types for Runtime Agents
 *
 * This module provides runtime-specific utilities for working with media bundles
 * and validating content from Python execution environments.
 *
 * Core MIME type definitions and type guards are now in `@runt/schema` for
 * consistent use across frontend and backend.
 */

// Re-export core types from schema for backwards compatibility
export {
  APPLICATION_MIME_TYPES,
  type ApplicationMimeType,
  IMAGE_MIME_TYPES,
  type ImageMimeType,
  isApplicationMimeType,
  isImageMimeType,
  isJsonMimeType,
  isJupyterMimeType,
  isKnownMimeType,
  isTextBasedMimeType,
  isTextMimeType,
  JUPYTER_MIME_TYPES,
  type JupyterMimeType,
  KNOWN_MIME_TYPES,
  type KnownMimeType,
  TEXT_MIME_TYPES,
  type TextMimeType,
} from "@runt/schema";

// Import type guards needed by validateMediaBundle
import { isJsonMimeType, isTextBasedMimeType } from "@runt/schema";

/**
 * A media bundle represents rich content that can be displayed in multiple formats.
 * Keys are MIME types, values are the content in that format.
 */
export interface MediaBundle {
  [mimeType: string]: unknown;
}

/**
 * Clean up media bundles to ensure consistent types
 *
 * Raw output from Python can have inconsistent types - JSON as strings,
 * numbers as strings, etc. This normalizes everything.
 *
 * @example
 * ```typescript
 * const rawBundle = {
 *   "application/json": '{"value": 42}',  // JSON as string
 *   "text/plain": 123,                    // Number as text
 *   "text/html": null                     // Invalid value
 * };
 *
 * const clean = validateMediaBundle(rawBundle);
 * // { "application/json": {value: 42}, "text/plain": "123" }
 * // (null values removed, types corrected)
 * ```
 */
export function validateMediaBundle(bundle: MediaBundle): MediaBundle {
  const result: MediaBundle = {};

  for (const [mimeType, value] of Object.entries(bundle)) {
    if (value == null) continue;

    if (isTextBasedMimeType(mimeType)) {
      // Text-based types should be strings
      result[mimeType] = String(value);
    } else if (isJsonMimeType(mimeType)) {
      // JSON types should be objects or properly formatted JSON strings
      if (typeof value === "object") {
        result[mimeType] = value;
      } else if (typeof value === "string") {
        try {
          result[mimeType] = JSON.parse(value);
        } catch {
          result[mimeType] = value; // Keep as string if not valid JSON
        }
      } else {
        result[mimeType] = value;
      }
    } else {
      // Keep other types as-is
      result[mimeType] = value;
    }
  }

  return result;
}

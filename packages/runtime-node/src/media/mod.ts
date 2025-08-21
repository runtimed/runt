/**
 * # Media Types for Runtime Agents
 *
 * This module provides runtime-specific utilities for working with media bundles
 * and validating content from Python execution environments.
 *
 * Core MIME type definitions and type guards are now in `@runt/schema` for
 * consistent use across frontend and backend.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { validateMediaBundle } from "@runt/lib/media";
 *
 * // Raw output from Python execution
 * const rawOutput = {
 *   "text/html": "<table><tr><td>Revenue: $50K</td></tr></table>",
 *   "text/markdown": "| Revenue |\n|$50K|",
 *   "application/json": { revenue: 50000, currency: "USD" }
 * };
 *
 * // Validate and normalize the bundle
 * const validated = validateMediaBundle(rawOutput);
 * ```
 */

// Core types and constants (re-exported from schema for consistency)
export type {
  ApplicationMimeType,
  ImageMimeType,
  JupyterMimeType,
  KnownMimeType,
  TextMimeType,
} from "@runt/schema";

export {
  APPLICATION_MIME_TYPES,
  IMAGE_MIME_TYPES,
  JUPYTER_MIME_TYPES,
  KNOWN_MIME_TYPES,
  TEXT_MIME_TYPES,
} from "@runt/schema";

// Type guards (re-exported from schema)
export {
  isApplicationMimeType,
  isImageMimeType,
  isJsonMimeType,
  isJupyterMimeType,
  isKnownMimeType,
  isTextBasedMimeType,
  isTextMimeType,
} from "@runt/schema";

// Runtime-specific types and utilities
export type { MediaBundle } from "./types.ts";

export { validateMediaBundle } from "./types.ts";

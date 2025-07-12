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

/**
 * Configuration for artifact uploads
 */
export interface ArtifactUploadConfig {
  syncUrl: string;
  authToken: string;
  notebookId: string;
  threshold?: number; // Default 16KB
}

/**
 * Response from artifact upload
 */
export interface ArtifactUploadResponse {
  artifactId: string;
  byteLength: number;
  mimeType: string;
}

/**
 * Upload data as an artifact if it exceeds the size threshold
 *
 * @param data - The data to potentially upload as an artifact
 * @param mimeType - MIME type of the data
 * @param config - Upload configuration
 * @returns Promise resolving to either inline data or artifact reference
 *
 * @example
 * ```typescript
 * const config = {
 *   syncUrl: "https://api.example.com",
 *   authToken: "abc123",
 *   notebookId: "notebook-456"
 * };
 *
 * // Small data stays inline
 * const small = await uploadArtifactIfNeeded("Hello", "text/plain", config);
 * // { type: "inline", data: "Hello" }
 *
 * // Large data becomes artifact
 * const large = await uploadArtifactIfNeeded(largeImageData, "image/png", config);
 * // { type: "artifact", artifactId: "notebook-456/abc123...", metadata: {...} }
 * ```
 */
export async function uploadArtifactIfNeeded(
  data: ArrayBuffer | string,
  mimeType: string,
  config: ArtifactUploadConfig,
): Promise<
  {
    type: "inline";
    data: unknown;
  } | {
    type: "artifact";
    artifactId: string;
    metadata: { byteLength: number; mimeType: string };
  }
> {
  const threshold = config.threshold || 16384; // 16KB default

  // Convert data to ArrayBuffer for size checking
  let buffer: ArrayBuffer;
  if (typeof data === "string") {
    const encoded = new TextEncoder().encode(data);
    buffer = new ArrayBuffer(encoded.byteLength);
    new Uint8Array(buffer).set(encoded);
  } else {
    buffer = data;
  }

  // If below threshold, return inline
  if (buffer.byteLength <= threshold) {
    return {
      type: "inline",
      data: typeof data === "string" ? data : buffer,
    };
  }

  // Upload as artifact
  const response = await uploadArtifact(buffer, mimeType, config);

  return {
    type: "artifact",
    artifactId: response.artifactId,
    metadata: {
      byteLength: response.byteLength,
      mimeType: response.mimeType,
    },
  };
}

/**
 * Upload data as an artifact to the sync backend
 *
 * @param data - Binary data to upload
 * @param mimeType - MIME type of the data
 * @param config - Upload configuration
 * @returns Promise resolving to upload response
 */
export async function uploadArtifact(
  data: ArrayBuffer,
  mimeType: string,
  config: ArtifactUploadConfig,
): Promise<ArtifactUploadResponse> {
  const url = `${config.syncUrl}/api/artifacts`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": mimeType,
      "X-Notebook-ID": config.notebookId,
      "X-Auth-Token": config.authToken,
    },
    body: data,
  });

  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage: string;

    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.message ||
        `Upload failed with status ${response.status}`;
    } catch {
      errorMessage =
        `Upload failed with status ${response.status}: ${errorText}`;
    }

    throw new Error(`Artifact upload failed: ${errorMessage}`);
  }

  return await response.json() as ArtifactUploadResponse;
}

/**
 * Generate a content URL for an artifact
 *
 * @param artifactId - The artifact identifier
 * @param config - Configuration containing sync URL and auth token
 * @returns URL for accessing the artifact content
 */
export function getArtifactContentUrl(
  artifactId: string,
  config: Pick<ArtifactUploadConfig, "syncUrl" | "authToken">,
): string {
  const url = new URL(`/api/artifacts/${artifactId}`, config.syncUrl);
  url.searchParams.set("token", config.authToken);
  return url.toString();
}

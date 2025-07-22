/**
 * # Artifact Service Client
 *
 * Client for submitting artifacts to the anode artifact service.
 * Handles PNG image processing and submission to the existing artifact backend.
 */

import { decodeBase64, encodeBase64 } from "@std/encoding/base64";

export interface ArtifactSubmissionOptions {
  notebookId: string;
  authToken: string;
  mimeType?: string;
  filename?: string;
}

export interface ArtifactSubmissionResult {
  artifactId: string;
}

/**
 * Client for interacting with the anode artifact service
 */
export class ArtifactClient {
  // TODO: Make artifact service URL configuration more general for @runt/lib package
  constructor(private baseUrl: string = "https://api.runt.run") {}

  /**
   * Submit PNG image data to the artifact service
   */
  async submitPng(
    pngData: Uint8Array,
    options: ArtifactSubmissionOptions,
  ): Promise<ArtifactSubmissionResult> {
    if (!this.isPngData(pngData)) {
      throw new Error("Invalid PNG data: missing PNG header");
    }

    return await this.submitArtifact(pngData, {
      ...options,
      mimeType: "image/png",
    });
  }

  /**
   * Submit PNG from base64 string
   */
  async submitPngFromBase64(
    base64Data: string,
    options: ArtifactSubmissionOptions,
  ): Promise<ArtifactSubmissionResult> {
    try {
      const pngData = decodeBase64(base64Data);
      return await this.submitPng(pngData, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to decode base64 PNG data: ${message}`);
    }
  }

  /**
   * Submit arbitrary artifact data
   */
  async submitArtifact(
    data: Uint8Array,
    options: ArtifactSubmissionOptions,
  ): Promise<ArtifactSubmissionResult> {
    const url = `${this.baseUrl}/api/artifacts`;

    const headers: Record<string, string> = {
      "authorization": `Bearer ${options.authToken}`,
      "x-notebook-id": options.notebookId,
    };

    if (options.mimeType) {
      headers["content-type"] = options.mimeType;
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: data,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({
          error: "Unknown error",
        }));
        throw new Error(
          `Artifact submission failed: ${error.error || response.statusText}`,
        );
      }

      const result = await response.json();
      return result as ArtifactSubmissionResult;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to submit artifact: ${String(error)}`);
    }
  }

  /**
   * Retrieve artifact by ID
   */
  async retrieveArtifact(artifactId: string): Promise<Uint8Array> {
    const url = `${this.baseUrl}/api/artifacts/${artifactId}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Artifact not found: ${artifactId}`);
        }
        throw new Error(`Failed to retrieve artifact: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return new Uint8Array(arrayBuffer);
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to retrieve artifact: ${String(error)}`);
    }
  }

  /**
   * Retrieve PNG artifact as base64 string
   */
  async retrievePngAsBase64(artifactId: string): Promise<string> {
    const data = await this.retrieveArtifact(artifactId);

    if (!this.isPngData(data)) {
      throw new Error(`Artifact ${artifactId} is not a valid PNG image`);
    }

    return encodeBase64(data);
  }

  /**
   * Get the public URL for an artifact (for direct access)
   */
  getArtifactUrl(artifactId: string): string {
    return `${this.baseUrl}/api/artifacts/${artifactId}`;
  }

  /**
   * Validate PNG data by checking for PNG header
   */
  private isPngData(data: Uint8Array): boolean {
    if (data.length < 8) return false;

    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    for (let i = 0; i < 8; i++) {
      if (data[i] !== pngSignature[i]) {
        return false;
      }
    }

    return true;
  }
}

/**
 * Create an artifact client with default configuration
 */
export function createArtifactClient(baseUrl?: string): ArtifactClient {
  return new ArtifactClient(baseUrl);
}

/**
 * Process and submit PNG images to the artifact service
 */
export class PngProcessor {
  constructor(private client: ArtifactClient) {}

  /**
   * Process PNG from various sources and submit to artifact service
   */
  async processPngData(
    source: Uint8Array | string,
    options: ArtifactSubmissionOptions,
  ): Promise<ArtifactSubmissionResult> {
    if (typeof source === "string") {
      // Assume base64 encoded
      return await this.client.submitPngFromBase64(source, options);
    } else {
      // Raw binary data
      return await this.client.submitPng(source, options);
    }
  }

  /**
   * Validate PNG dimensions and file size
   */
  validatePng(data: Uint8Array, maxSizeBytes: number = 10 * 1024 * 1024): void {
    if (!this.client["isPngData"](data)) {
      throw new Error("Invalid PNG data");
    }

    if (data.length > maxSizeBytes) {
      throw new Error(
        `PNG file too large: ${data.length} bytes (max: ${maxSizeBytes})`,
      );
    }

    // Could add more validation here:
    // - Image dimensions
    // - Color depth
    // - Compression ratio
  }
}

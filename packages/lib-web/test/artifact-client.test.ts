/**
 * Tests for the Artifact Client
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { encodeBase64 } from "@std/encoding/base64";
import { createArtifactClient, PngProcessor } from "../src/artifact-client.ts";

// Valid PNG signature + minimal IHDR chunk
const validPngData = new Uint8Array([
  0x89,
  0x50,
  0x4E,
  0x47,
  0x0D,
  0x0A,
  0x1A,
  0x0A, // PNG signature
  0x00,
  0x00,
  0x00,
  0x0D, // IHDR chunk length
  0x49,
  0x48,
  0x44,
  0x52, // IHDR
  0x00,
  0x00,
  0x00,
  0x01, // Width: 1
  0x00,
  0x00,
  0x00,
  0x01, // Height: 1
  0x08,
  0x02,
  0x00,
  0x00,
  0x00, // Bit depth, color type, compression, filter, interlace
  0x90,
  0x77,
  0x53,
  0xDE, // CRC
]);

const invalidPngData = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

const mockSubmissionOptions = {
  notebookId: "test-notebook",
  authToken: "test-token",
};

// Mock fetch for testing
const originalFetch = globalThis.fetch;

function mockFetch(responses: Record<string, Response>) {
  globalThis.fetch = (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const response = responses[url];
    if (!response) {
      throw new Error(`Unexpected fetch to: ${url}`);
    }
    return Promise.resolve(response);
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

Deno.test("ArtifactClient", async (t) => {
  await t.step("should create client with default base URL", () => {
    const client = createArtifactClient();
    assertEquals(
      client.getArtifactUrl("test-id"),
      "https://api.runt.run/api/artifacts/test-id",
    );
  });

  await t.step("should create client with custom base URL", () => {
    const client = createArtifactClient("https://custom.example.com");
    assertEquals(
      client.getArtifactUrl("test-id"),
      "https://custom.example.com/api/artifacts/test-id",
    );
  });

  await t.step("should submit PNG successfully", async () => {
    const expectedResponse = { artifactId: "test-notebook/abc123" };

    mockFetch({
      "https://api.runt.run/api/artifacts": new Response(
        JSON.stringify(expectedResponse),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });

    try {
      const client = createArtifactClient();
      const result = await client.submitPng(
        validPngData,
        mockSubmissionOptions,
      );

      assertEquals(result.artifactId, "test-notebook/abc123");
    } finally {
      restoreFetch();
    }
  });

  await t.step("should submit PNG from base64", async () => {
    const expectedResponse = { artifactId: "test-notebook/def456" };
    const base64Data = encodeBase64(validPngData);

    mockFetch({
      "https://api.runt.run/api/artifacts": new Response(
        JSON.stringify(expectedResponse),
        { status: 200 },
      ),
    });

    try {
      const client = createArtifactClient();
      const result = await client.submitPngFromBase64(
        base64Data,
        mockSubmissionOptions,
      );

      assertEquals(result.artifactId, "test-notebook/def456");
    } finally {
      restoreFetch();
    }
  });

  await t.step("should reject invalid PNG data", async () => {
    const client = createArtifactClient();

    await assertRejects(
      () => client.submitPng(invalidPngData, mockSubmissionOptions),
      Error,
      "Invalid PNG data: missing PNG header",
    );
  });

  await t.step("should reject invalid base64 data", async () => {
    const client = createArtifactClient();

    await assertRejects(
      () =>
        client.submitPngFromBase64("invalid-base64!@#", mockSubmissionOptions),
      Error,
      "Failed to decode base64 PNG data",
    );
  });

  await t.step("should handle submission errors", async () => {
    mockFetch({
      "https://api.runt.run/api/artifacts": new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401 },
      ),
    });

    try {
      const client = createArtifactClient();

      await assertRejects(
        () => client.submitPng(validPngData, mockSubmissionOptions),
        Error,
        "Artifact submission failed: Unauthorized",
      );
    } finally {
      restoreFetch();
    }
  });

  await t.step("should retrieve artifact data", async () => {
    mockFetch({
      "https://api.runt.run/api/artifacts/test-id": new Response(
        validPngData,
        { status: 200, headers: { "Content-Type": "image/png" } },
      ),
    });

    try {
      const client = createArtifactClient();
      const data = await client.retrieveArtifact("test-id");

      assertEquals(data, validPngData);
    } finally {
      restoreFetch();
    }
  });

  await t.step("should retrieve PNG as base64", async () => {
    const expected = encodeBase64(validPngData);

    mockFetch({
      "https://api.runt.run/api/artifacts/test-id": new Response(
        validPngData,
        { status: 200 },
      ),
    });

    try {
      const client = createArtifactClient();
      const result = await client.retrievePngAsBase64("test-id");

      assertEquals(result, expected);
    } finally {
      restoreFetch();
    }
  });

  await t.step("should handle retrieval errors", async () => {
    mockFetch({
      "https://api.runt.run/api/artifacts/nonexistent": new Response(
        JSON.stringify({ error: "Not Found" }),
        { status: 404 },
      ),
    });

    try {
      const client = createArtifactClient();

      await assertRejects(
        () => client.retrieveArtifact("nonexistent"),
        Error,
        "Artifact not found: nonexistent",
      );
    } finally {
      restoreFetch();
    }
  });

  await t.step(
    "should reject non-PNG data when retrieving as PNG",
    async () => {
      const textData = new TextEncoder().encode("Hello World");

      mockFetch({
        "https://api.runt.run/api/artifacts/text-id": new Response(
          textData,
          { status: 200 },
        ),
      });

      try {
        const client = createArtifactClient();

        await assertRejects(
          () => client.retrievePngAsBase64("text-id"),
          Error,
          "Artifact text-id is not a valid PNG image",
        );
      } finally {
        restoreFetch();
      }
    },
  );
});

Deno.test("PngProcessor", async (t) => {
  await t.step("should process PNG from binary data", async () => {
    const expectedResponse = { artifactId: "test-notebook/xyz789" };

    mockFetch({
      "https://api.runt.run/api/artifacts": new Response(
        JSON.stringify(expectedResponse),
        { status: 200 },
      ),
    });

    try {
      const client = createArtifactClient();
      const processor = new PngProcessor(client);

      const result = await processor.processPngData(
        validPngData,
        mockSubmissionOptions,
      );
      assertEquals(result.artifactId, "test-notebook/xyz789");
    } finally {
      restoreFetch();
    }
  });

  await t.step("should process PNG from base64 string", async () => {
    const expectedResponse = { artifactId: "test-notebook/base64-test" };
    const base64Data = encodeBase64(validPngData);

    mockFetch({
      "https://api.runt.run/api/artifacts": new Response(
        JSON.stringify(expectedResponse),
        { status: 200 },
      ),
    });

    try {
      const client = createArtifactClient();
      const processor = new PngProcessor(client);

      const result = await processor.processPngData(
        base64Data,
        mockSubmissionOptions,
      );
      assertEquals(result.artifactId, "test-notebook/base64-test");
    } finally {
      restoreFetch();
    }
  });

  await t.step("should validate PNG successfully", () => {
    const client = createArtifactClient();
    const processor = new PngProcessor(client);

    // Should not throw
    processor.validatePng(validPngData);
  });

  await t.step("should reject invalid PNG in validation", () => {
    const client = createArtifactClient();
    const processor = new PngProcessor(client);

    assertThrows(
      () => processor.validatePng(invalidPngData),
      Error,
      "Invalid PNG data",
    );
  });

  await t.step("should reject oversized PNG", () => {
    const client = createArtifactClient();
    const processor = new PngProcessor(client);

    assertThrows(
      () => processor.validatePng(validPngData, 10), // 10 byte limit
      Error,
      "PNG file too large",
    );
  });
});

/**
 * Tests for size-based artifact upload functionality in RuntimeAgent
 */

import { assertEquals, assertRejects } from "@std/assert";
import { encodeBase64 } from "@std/encoding/base64";
import { RuntimeAgent } from "./runtime-agent.ts";
import { RuntimeConfig } from "./config.ts";
import type { RuntimeAgentOptions } from "./types.ts";

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

// Create a larger PNG for testing size threshold
const largePngData = new Uint8Array(2 * 1024 * 1024); // 2MB
largePngData.set(validPngData); // Start with valid PNG header

const mockRuntimeOptions: RuntimeAgentOptions = {
  runtimeId: "test-runtime",
  runtimeType: "test",
  capabilities: {
    canExecuteCode: true,
    canExecuteSql: false,
    canExecuteAi: false,
  },
  syncUrl: "wss://test.runt.run",
  authToken: "test-token",
  notebookId: "test-notebook",
  imageArtifactThresholdBytes: 32 * 1024, // 32KB threshold
  environmentOptions: {},
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

Deno.test("RuntimeAgent Artifact Upload", async (t) => {
  await t.step("should handle small PNG inline", async () => {
    const config = new RuntimeConfig(mockRuntimeOptions);
    const agent = new RuntimeAgent(config, mockRuntimeOptions.capabilities);

    const smallPngBase64 = encodeBase64(validPngData);

    // Access the private method for testing
    const result = await (agent as any).processImageContent(
      "image/png",
      smallPngBase64,
      { test: "metadata" },
    );

    assertEquals(result.type, "inline");
    assertEquals(result.data, smallPngBase64);
    assertEquals(result.metadata?.test, "metadata");
  });

  await t.step("should upload large PNG as artifact", async () => {
    const expectedResponse = { artifactId: "test-notebook/large-image" };

    mockFetch({
      "https://test.runt.run/api/artifacts": new Response(
        JSON.stringify(expectedResponse),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });

    try {
      const config = new RuntimeConfig(mockRuntimeOptions);
      const agent = new RuntimeAgent(config, mockRuntimeOptions.capabilities);

      const largePngBase64 = encodeBase64(largePngData);

      // Access the private method for testing
      const result = await (agent as any).processImageContent(
        "image/png",
        largePngBase64,
        { test: "metadata" },
      );

      assertEquals(result.type, "artifact");
      assertEquals(result.artifactId, "test-notebook/large-image");
      assertEquals(result.metadata?.test, "metadata");
      assertEquals(result.metadata?.originalSizeBytes, largePngData.length);
      assertEquals(typeof result.metadata?.uploadedAt, "string");
    } finally {
      restoreFetch();
    }
  });

  await t.step("should fall back to inline on upload failure", async () => {
    mockFetch({
      "https://test.runt.run/api/artifacts": new Response(
        JSON.stringify({ error: "Server Error" }),
        { status: 500 },
      ),
    });

    try {
      const config = new RuntimeConfig(mockRuntimeOptions);
      const agent = new RuntimeAgent(config, mockRuntimeOptions.capabilities);

      const largePngBase64 = encodeBase64(largePngData);

      // Access the private method for testing
      const result = await (agent as any).processImageContent(
        "image/png",
        largePngBase64,
        { test: "metadata" },
      );

      // Should fall back to inline when upload fails
      assertEquals(result.type, "inline");
      assertEquals(result.data, largePngBase64);
      assertEquals(result.metadata?.test, "metadata");
    } finally {
      restoreFetch();
    }
  });

  await t.step("should handle non-PNG mime types inline", async () => {
    const config = new RuntimeConfig(mockRuntimeOptions);
    const agent = new RuntimeAgent(config, mockRuntimeOptions.capabilities);

    const jpegData = "fake-jpeg-data";

    // Access the private method for testing
    const result = await (agent as any).processImageContent(
      "image/jpeg",
      jpegData,
      { test: "metadata" },
    );

    assertEquals(result.type, "inline");
    assertEquals(result.data, jpegData);
    assertEquals(result.metadata?.test, "metadata");
  });

  await t.step("should handle non-string content inline", async () => {
    const config = new RuntimeConfig(mockRuntimeOptions);
    const agent = new RuntimeAgent(config, mockRuntimeOptions.capabilities);

    const objectData = { width: 100, height: 200 };

    // Access the private method for testing
    const result = await (agent as any).processImageContent(
      "image/png",
      objectData,
      { test: "metadata" },
    );

    assertEquals(result.type, "inline");
    assertEquals(result.data, objectData);
    assertEquals(result.metadata?.test, "metadata");
  });

  await t.step("should use custom threshold from config", async () => {
    const customOptions = {
      ...mockRuntimeOptions,
      imageArtifactThresholdBytes: 10, // Very small threshold (smaller than our test PNG)
    };

    const expectedResponse = { artifactId: "test-notebook/threshold-test" };

    mockFetch({
      "https://test.runt.run/api/artifacts": new Response(
        JSON.stringify(expectedResponse),
        { status: 200 },
      ),
    });

    try {
      const config = new RuntimeConfig(customOptions);
      const agent = new RuntimeAgent(config, customOptions.capabilities);

      const smallPngBase64 = encodeBase64(validPngData); // This is > 10 bytes when decoded

      // Access the private method for testing
      const result = await (agent as any).processImageContent(
        "image/png",
        smallPngBase64,
        {},
      );

      // Should upload as artifact due to small threshold
      assertEquals(result.type, "artifact");
      assertEquals(result.artifactId, "test-notebook/threshold-test");
    } finally {
      restoreFetch();
    }
  });
});

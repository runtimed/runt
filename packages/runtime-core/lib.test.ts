import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  ArtifactClient,
  createArtifactClient,
  createLogger,
  Logger,
  PngProcessor,
  RuntimeAgent,
  validateMediaBundle,
} from "./mod.ts";
import type {
  MediaBundle,
  RuntimeAgentOptions,
  RuntimeCapabilities,
} from "./mod.ts";

Deno.test("Runtime Core - Library exports are available", () => {
  // Test that main exports are defined
  assertEquals(typeof RuntimeAgent, "function");
  assertEquals(typeof validateMediaBundle, "function");
  assertEquals(typeof createLogger, "function");
  assertEquals(typeof Logger, "function");
  assertEquals(typeof ArtifactClient, "function");
  assertEquals(typeof createArtifactClient, "function");
  assertEquals(typeof PngProcessor, "function");
});

Deno.test("Runtime Core - Types are properly exported", () => {
  // Test that TypeScript types can be used (this verifies they're exported)
  const options: RuntimeAgentOptions = {
    runtimeId: "test-runtime",
    runtimeType: "test",
    clientId: "test-user",
  };

  const capabilities: RuntimeCapabilities = {
    canExecuteCode: true,
    canExecuteSql: false,
    canExecuteAi: false,
  };

  const mediaBundle: MediaBundle = {
    "text/plain": "Hello world",
  };

  // Verify the types have expected structure
  assertEquals(typeof options.runtimeId, "string");
  assertEquals(typeof capabilities.canExecuteCode, "boolean");
  assertEquals(typeof mediaBundle["text/plain"], "string");
});

Deno.test("Runtime Core - Media validation works", () => {
  const rawBundle = {
    "text/plain": "Hello",
    "text/html": "<h1>Hello</h1>",
    "application/json": { message: "Hello" },
    "image/png": "base64data",
  };

  const validated = validateMediaBundle(rawBundle);

  assertEquals(validated["text/plain"], "Hello");
  assertEquals(validated["text/html"], "<h1>Hello</h1>");
  assertEquals(typeof validated["application/json"], "object");
  assertEquals(validated["image/png"], "base64data");
});

Deno.test("Runtime Core - Logger creation works", () => {
  const logger = createLogger("test-logger");

  assertExists(logger);
  assertEquals(typeof logger.info, "function");
  assertEquals(typeof logger.error, "function");
  assertEquals(typeof logger.debug, "function");
  assertEquals(typeof logger.warn, "function");
});

Deno.test("Runtime Core - ArtifactClient creation works", () => {
  const client = createArtifactClient("http://localhost:8080");

  assertExists(client);
  assertEquals(typeof client.submitContent, "function");
});

Deno.test("Runtime Core - RuntimeAgent requires proper constructor args", () => {
  // We can't easily test RuntimeAgent creation here without a real store,
  // but we can verify it's a constructor function
  assertEquals(typeof RuntimeAgent, "function");
  assertEquals(RuntimeAgent.prototype.constructor, RuntimeAgent);
});

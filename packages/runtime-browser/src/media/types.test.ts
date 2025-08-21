import { assert, assertEquals } from "jsr:@std/assert";
import {
  APPLICATION_MIME_TYPES,
  IMAGE_MIME_TYPES,
  isApplicationMimeType,
  isImageMimeType,
  isJsonMimeType,
  isJupyterMimeType,
  isKnownMimeType,
  isTextBasedMimeType,
  isTextMimeType,
  JUPYTER_MIME_TYPES,
  KNOWN_MIME_TYPES,
  TEXT_MIME_TYPES,
} from "@runt/schema";
import { validateMediaBundle } from "./types.ts";
import {
  ensureTextPlainFallback,
  type RichOutputData,
  toAIMediaBundle,
} from "@runt/ai";

Deno.test("Media Type Constants", () => {
  // Check that constants are non-empty
  assert(TEXT_MIME_TYPES.length > 0, "TEXT_MIME_TYPES should not be empty");
  assert(
    APPLICATION_MIME_TYPES.length > 0,
    "APPLICATION_MIME_TYPES should not be empty",
  );
  assert(IMAGE_MIME_TYPES.length > 0, "IMAGE_MIME_TYPES should not be empty");
  assert(
    JUPYTER_MIME_TYPES.length > 0,
    "JUPYTER_MIME_TYPES should not be empty",
  );

  // Check that KNOWN_MIME_TYPES includes all others
  for (const mimeType of TEXT_MIME_TYPES) {
    assert(
      KNOWN_MIME_TYPES.includes(mimeType),
      `KNOWN_MIME_TYPES should include ${mimeType}`,
    );
  }
  for (const mimeType of APPLICATION_MIME_TYPES) {
    assert(
      KNOWN_MIME_TYPES.includes(mimeType),
      `KNOWN_MIME_TYPES should include ${mimeType}`,
    );
  }
  for (const mimeType of IMAGE_MIME_TYPES) {
    assert(
      KNOWN_MIME_TYPES.includes(mimeType),
      `KNOWN_MIME_TYPES should include ${mimeType}`,
    );
  }
  for (const mimeType of JUPYTER_MIME_TYPES) {
    assert(
      KNOWN_MIME_TYPES.includes(mimeType),
      `KNOWN_MIME_TYPES should include ${mimeType}`,
    );
  }
});

Deno.test("Type Guards", () => {
  // Text types
  assert(isTextMimeType("text/plain"));
  assert(isTextMimeType("text/html"));
  assert(!isTextMimeType("application/json"));

  // Application types
  assert(isApplicationMimeType("application/json"));
  assert(isApplicationMimeType("application/javascript"));
  assert(!isApplicationMimeType("text/plain"));

  // Image types
  assert(isImageMimeType("image/png"));
  assert(isImageMimeType("image/svg+xml"));
  assert(!isImageMimeType("text/plain"));

  // Jupyter types
  assert(isJupyterMimeType("application/vnd.jupyter.widget-state+json"));
  assert(isJupyterMimeType("application/vnd.plotly.v1+json"));
  assert(!isJupyterMimeType("text/plain"));

  // Known types
  assert(isKnownMimeType("text/plain"));
  assert(isKnownMimeType("application/json"));
  assert(!isKnownMimeType("application/unknown"));

  // JSON types (including +json extensions)
  assert(isJsonMimeType("application/json"));
  assert(isJsonMimeType("application/vnd.custom+json"));
  assert(isJsonMimeType("application/vnd.plotly.v1+json"));
  assert(!isJsonMimeType("text/plain"));

  // Text-based types
  assert(isTextBasedMimeType("text/plain"));
  assert(isTextBasedMimeType("text/html"));
  assert(isTextBasedMimeType("application/javascript"));
  assert(isTextBasedMimeType("image/svg+xml"));
  assert(!isTextBasedMimeType("image/png"));
  assert(!isTextBasedMimeType("application/json"));
});

Deno.test("AI Media Bundle Conversion", () => {
  // Test AI-friendly conversion
  const richOutput: RichOutputData = {
    "text/plain": { type: "inline", data: "Hello, world!" },
    "text/html": { type: "inline", data: "<h1>Hello, world!</h1>" },
    "text/markdown": { type: "inline", data: "# Hello, world!" },
    "application/json": { type: "inline", data: { message: "Hello" } },
    "image/png": { type: "inline", data: "base64data" },
  };

  const aiBundle = toAIMediaBundle(richOutput);

  // Should include text/plain
  assert("text/plain" in aiBundle);
  assertEquals(aiBundle["text/plain"], "Hello, world!");

  // Should prefer markdown over HTML for AI
  assert("text/markdown" in aiBundle);
  assertEquals(aiBundle["text/markdown"], "# Hello, world!");

  // Should include JSON for structured data
  assert("application/json" in aiBundle);
  assertEquals(aiBundle["application/json"], { message: "Hello" });

  // Should include images for AI providers that support them
  assert("image/png" in aiBundle);
  assertEquals(aiBundle["image/png"], "base64data");

  // Should not include HTML when markdown is available
  assert(!("text/html" in aiBundle));
});

Deno.test("AI Bundle HTML to Plain Conversion", () => {
  // When no markdown available, should convert HTML to plain text
  const richOutput: RichOutputData = {
    "text/html": { type: "inline", data: "<h1>Hello, world!</h1>" },
    "application/json": { type: "inline", data: { message: "Hello" } },
  };

  const aiBundle = toAIMediaBundle(richOutput);

  // Should have converted HTML to plain text
  assert("text/plain" in aiBundle);
  assertEquals(aiBundle["text/plain"], "Hello, world!");

  // Should include JSON
  assert("application/json" in aiBundle);

  // Should not include HTML
  assert(!("text/html" in aiBundle));

  // Empty bundle
  const emptyAI = toAIMediaBundle({});
  assertEquals(Object.keys(emptyAI).length, 0);
});

Deno.test("Ensure Text Plain Fallback", () => {
  // Bundle without text/plain
  const bundle = {
    "text/html": "<h1>Hello, world!</h1>",
    "application/json": { message: "Hello" },
  };

  const withFallback = ensureTextPlainFallback(bundle);
  assert("text/plain" in withFallback);
  assertEquals(withFallback["text/plain"], "Hello, world!"); // HTML stripped

  // Bundle with text/plain already
  const bundleWithPlain = {
    "text/plain": "Already here",
    "text/html": "<h1>Hello</h1>",
  };

  const unchanged = ensureTextPlainFallback(bundleWithPlain);
  assertEquals(unchanged["text/plain"], "Already here");

  // Markdown fallback
  const markdownBundle = {
    "text/markdown": "**Bold text**",
  };

  const markdownFallback = ensureTextPlainFallback(markdownBundle);
  assertEquals(markdownFallback["text/plain"], "**Bold text**");

  // JSON fallback
  const jsonBundle = {
    "application/json": { message: "Hello" },
  };

  const jsonFallback = ensureTextPlainFallback(jsonBundle);
  assert(typeof jsonFallback["text/plain"] === "string");
  assert(jsonFallback["text/plain"]!.includes("Hello"));

  // Empty bundle
  const emptyFallback = ensureTextPlainFallback({});
  assertEquals(emptyFallback["text/plain"], "");
});

Deno.test("Validate Media Bundle", () => {
  const rawBundle = {
    "text/plain": "Hello",
    "text/html": "<h1>Hello</h1>",
    "application/json": '{"message": "Hello"}', // JSON as string
    "application/vnd.custom+json": { data: "test" }, // JSON as object
    "image/png": "base64data",
    "application/javascript": "console.log('hello')",
  };

  const validated = validateMediaBundle(rawBundle);

  // Text types should remain strings
  assertEquals(typeof validated["text/plain"], "string");
  assertEquals(typeof validated["text/html"], "string");
  assertEquals(typeof validated["application/javascript"], "string");
  assertEquals(typeof validated["image/png"], "string");

  // JSON string should be parsed to object
  assertEquals(typeof validated["application/json"], "object");
  assert(validated["application/json"] !== null);
  assertEquals(
    (validated["application/json"] as { message: string }).message,
    "Hello",
  );

  // JSON object should remain object
  assertEquals(typeof validated["application/vnd.custom+json"], "object");

  // Null values should be filtered out
  const bundleWithNulls = {
    "text/plain": "Hello",
    "text/html": null,
    "application/json": undefined,
  };

  const cleanedBundle = validateMediaBundle(bundleWithNulls);
  assert("text/plain" in cleanedBundle);
  assert(!("text/html" in cleanedBundle));
  assert(!("application/json" in cleanedBundle));
});

Deno.test("Custom +json Media Types", () => {
  // Custom Jupyter extension
  const customType = "application/vnd.myapp.chart+json";
  assert(isJsonMimeType(customType));
  assert(!isKnownMimeType(customType)); // Not in our predefined list

  // Anode media type example
  const anodeType = "application/vnd.anode.aitool+json";
  assert(isJsonMimeType(anodeType));

  // Should work in bundle validation
  const bundle = {
    [customType]: { chart: "data" },
    [anodeType]: { tool: "info" },
  };

  const validated = validateMediaBundle(bundle);
  assertEquals(typeof validated[customType], "object");
  assertEquals(typeof validated[anodeType], "object");

  // Should work in AI conversion (custom +json types aren't included by default)
  const bundleWithCustom: RichOutputData = {
    "text/plain": { type: "inline", data: "Hello" },
    [customType]: { type: "inline", data: { chart: "data" } },
  };

  const aiBundle = toAIMediaBundle(bundleWithCustom);
  assert("text/plain" in aiBundle);
  assert(!(customType in aiBundle)); // Custom types not included in AI conversion by default
});

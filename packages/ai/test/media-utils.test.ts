/**
 * Comprehensive tests for AI media utilities
 */

import { assertEquals, assertObjectMatch } from "jsr:@std/assert";
import {
  type AIMediaBundle,
  ensureTextPlainFallback,
  extractStructuredData,
  hasVisualContent,
  type RichOutputData,
  toAIContext,
  toAIMediaBundle,
} from "../media-utils.ts";

Deno.test("AI Media Utils - toAIMediaBundle", async (t) => {
  await t.step("should prioritize markdown over HTML", () => {
    const richOutput: RichOutputData = {
      "text/html": {
        type: "inline",
        data: "<h1>Report</h1><p>Content</p>",
      },
      "text/markdown": {
        type: "inline",
        data: "# Report\n\nContent",
      },
      "text/plain": {
        type: "inline",
        data: "Report\n\nContent",
      },
    };

    const result = toAIMediaBundle(richOutput);

    assertEquals(result["text/markdown"], "# Report\n\nContent");
    assertEquals(result["text/plain"], "Report\n\nContent");
    assertEquals(result["text/html"], undefined);
  });

  await t.step("should include HTML when no markdown available", () => {
    const richOutput: RichOutputData = {
      "text/html": {
        type: "inline",
        data: "<h1>Test</h1>",
      },
      "text/plain": {
        type: "inline",
        data: "Test",
      },
    };

    const result = toAIMediaBundle(richOutput);

    assertEquals(result["text/plain"], "Test");
    assertEquals(result["text/markdown"], undefined);
    assertEquals(result["text/html"], undefined); // HTML gets converted to plain text
  });

  await t.step("should include JSON data", () => {
    const richOutput: RichOutputData = {
      "application/json": {
        type: "inline",
        data: { revenue: 10000, profit: 2000 },
      },
      "text/plain": {
        type: "inline",
        data: "Financial data",
      },
    };

    const result = toAIMediaBundle(richOutput);

    assertEquals(result["application/json"], { revenue: 10000, profit: 2000 });
    assertEquals(result["text/plain"], "Financial data");
  });

  await t.step("should include image data", () => {
    const richOutput: RichOutputData = {
      "image/png": {
        type: "inline",
        data: "base64imagedata",
      },
      "text/plain": {
        type: "inline",
        data: "Chart image",
      },
    };

    const result = toAIMediaBundle(richOutput);

    assertEquals(result["image/png"], "base64imagedata");
    assertEquals(result["text/plain"], "Chart image");
  });

  await t.step("should handle empty input", () => {
    const richOutput: RichOutputData = {};
    const result = toAIMediaBundle(richOutput);
    assertEquals(result, {});
  });

  await t.step("should handle artifact containers", () => {
    const richOutput: RichOutputData = {
      "text/plain": {
        type: "artifact",
        artifactId: "test-artifact",
      },
    };

    const result = toAIMediaBundle(richOutput);
    assertEquals(result, {}); // Artifacts are not included in AI bundles
  });
});

Deno.test("AI Media Utils - ensureTextPlainFallback", async (t) => {
  await t.step("should preserve existing text/plain", () => {
    const bundle: AIMediaBundle = {
      "text/plain": "Original text",
      "text/html": "<p>HTML text</p>",
    };

    const result = ensureTextPlainFallback(bundle);

    assertEquals(result["text/plain"], "Original text");
    assertEquals(result["text/html"], "<p>HTML text</p>");
  });

  await t.step("should generate text/plain from HTML", () => {
    const bundle: AIMediaBundle = {
      "text/html": "<h1>Title</h1><p>Content</p>",
    };

    const result = ensureTextPlainFallback(bundle);

    assertEquals(result["text/plain"], "TitleContent");
    assertEquals(result["text/html"], "<h1>Title</h1><p>Content</p>");
  });

  await t.step("should use markdown as text/plain", () => {
    const bundle: AIMediaBundle = {
      "text/markdown": "# Title\n\nContent",
    };

    const result = ensureTextPlainFallback(bundle);

    assertEquals(result["text/plain"], "# Title\n\nContent");
    assertEquals(result["text/markdown"], "# Title\n\nContent");
  });

  await t.step("should use first string value as fallback", () => {
    const bundle: AIMediaBundle = {
      "custom/format": "Some text content",
      "application/json": { data: "object" },
    };

    const result = ensureTextPlainFallback(bundle);

    assertEquals(result["text/plain"], "Some text content");
  });

  await t.step("should JSON stringify non-string content", () => {
    const bundle: AIMediaBundle = {
      "application/json": { revenue: 1000 },
    };

    const result = ensureTextPlainFallback(bundle);

    assertEquals(result["text/plain"], '{\n  "revenue": 1000\n}');
  });

  await t.step("should handle empty bundle", () => {
    const bundle: AIMediaBundle = {};
    const result = ensureTextPlainFallback(bundle);
    assertEquals(result["text/plain"], "");
  });
});

Deno.test("AI Media Utils - toAIContext", async (t) => {
  await t.step("should return markdown when available", () => {
    const richOutput: RichOutputData = {
      "text/markdown": {
        type: "inline",
        data: "# Test\n\nContent",
      },
      "text/plain": {
        type: "inline",
        data: "Test Content",
      },
    };

    const result = toAIContext(richOutput);
    assertEquals(result, "# Test\n\nContent");
  });

  await t.step("should fallback to plain text", () => {
    const richOutput: RichOutputData = {
      "text/plain": {
        type: "inline",
        data: "Plain text content",
      },
      "text/html": {
        type: "inline",
        data: "<p>HTML content</p>",
      },
    };

    const result = toAIContext(richOutput);
    assertEquals(result, "Plain text content");
  });

  await t.step("should return JSON as string", () => {
    const richOutput: RichOutputData = {
      "application/json": {
        type: "inline",
        data: { message: "Hello" },
      },
    };

    const result = toAIContext(richOutput);
    assertEquals(result, '{\n  "message": "Hello"\n}');
  });

  await t.step("should return empty string for no content", () => {
    const richOutput: RichOutputData = {};
    const result = toAIContext(richOutput);
    assertEquals(result, "");
  });

  await t.step("should handle complex mixed content", () => {
    const richOutput: RichOutputData = {
      "text/markdown": {
        type: "inline",
        data: "# Analysis Results\n\n- Revenue: $10,000\n- Profit: $2,000",
      },
      "application/json": {
        type: "inline",
        data: { revenue: 10000, profit: 2000 },
      },
      "image/png": {
        type: "inline",
        data: "base64data",
      },
    };

    const result = toAIContext(richOutput);
    assertEquals(
      result,
      "# Analysis Results\n\n- Revenue: $10,000\n- Profit: $2,000",
    );
  });
});

Deno.test("AI Media Utils - hasVisualContent", async (t) => {
  await t.step("should detect PNG images", () => {
    const richOutput: RichOutputData = {
      "image/png": {
        type: "inline",
        data: "base64data",
      },
    };

    const result = hasVisualContent(richOutput);
    assertEquals(result, true);
  });

  await t.step("should detect JPEG images", () => {
    const richOutput: RichOutputData = {
      "image/jpeg": {
        type: "inline",
        data: "base64data",
      },
    };

    const result = hasVisualContent(richOutput);
    assertEquals(result, true);
  });

  await t.step("should detect SVG images", () => {
    const richOutput: RichOutputData = {
      "image/svg+xml": {
        type: "inline",
        data: "<svg>...</svg>",
      },
    };

    const result = hasVisualContent(richOutput);
    assertEquals(result, true);
  });

  await t.step("should return false for text-only content", () => {
    const richOutput: RichOutputData = {
      "text/plain": {
        type: "inline",
        data: "Just text",
      },
      "text/markdown": {
        type: "inline",
        data: "# Just markdown",
      },
    };

    const result = hasVisualContent(richOutput);
    assertEquals(result, false);
  });

  await t.step("should return false for artifact images", () => {
    const richOutput: RichOutputData = {
      "image/png": {
        type: "artifact",
        artifactId: "test-artifact",
      },
    };

    const result = hasVisualContent(richOutput);
    assertEquals(result, false);
  });

  await t.step("should return false for empty content", () => {
    const richOutput: RichOutputData = {};
    const result = hasVisualContent(richOutput);
    assertEquals(result, false);
  });
});

Deno.test("AI Media Utils - extractStructuredData", async (t) => {
  await t.step("should extract JSON data", () => {
    const richOutput: RichOutputData = {
      "application/json": {
        type: "inline",
        data: { revenue: 10000, expenses: 8000 },
      },
    };

    const result = extractStructuredData(richOutput);
    assertObjectMatch(result as Record<string, unknown>, {
      revenue: 10000,
      expenses: 8000,
    });
  });

  await t.step("should return null for non-JSON content", () => {
    const richOutput: RichOutputData = {
      "text/plain": {
        type: "inline",
        data: "Plain text",
      },
    };

    const result = extractStructuredData(richOutput);
    assertEquals(result, null);
  });

  await t.step("should return null for artifact JSON", () => {
    const richOutput: RichOutputData = {
      "application/json": {
        type: "artifact",
        artifactId: "test-artifact",
      },
    };

    const result = extractStructuredData(richOutput);
    assertEquals(result, null);
  });

  await t.step("should return null for empty content", () => {
    const richOutput: RichOutputData = {};
    const result = extractStructuredData(richOutput);
    assertEquals(result, null);
  });
});

Deno.test("AI Media Utils - Real-world scenarios", async (t) => {
  await t.step("should handle pandas DataFrame output", () => {
    const richOutput: RichOutputData = {
      "text/html": {
        type: "inline",
        data:
          "<table><tr><th>Name</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr></table>",
      },
      "text/plain": {
        type: "inline",
        data: "   Name  Value\n0     A      1",
      },
    };

    const context = toAIContext(richOutput);
    assertEquals(context, "   Name  Value\n0     A      1");

    const bundle = toAIMediaBundle(richOutput);
    assertEquals(bundle["text/plain"], "   Name  Value\n0     A      1");
    assertEquals(bundle["text/html"], undefined);
  });

  await t.step("should handle matplotlib plot output", () => {
    const richOutput: RichOutputData = {
      "image/png": {
        type: "inline",
        data:
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      },
      "text/plain": {
        type: "inline",
        data: "<matplotlib.figure.Figure at 0x7f8b8c0b5f40>",
      },
    };

    const hasVisual = hasVisualContent(richOutput);
    assertEquals(hasVisual, true);

    const context = toAIContext(richOutput);
    assertEquals(context, "<matplotlib.figure.Figure at 0x7f8b8c0b5f40>");

    const bundle = toAIMediaBundle(richOutput);
    assertEquals(
      bundle["image/png"],
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    );
  });

  await t.step("should handle IPython rich display output", () => {
    const richOutput: RichOutputData = {
      "text/markdown": {
        type: "inline",
        data:
          "**Analysis Complete**\n\n- Processed 1,000 records\n- Found 42 anomalies\n- Confidence: 95%",
      },
      "application/json": {
        type: "inline",
        data: {
          records_processed: 1000,
          anomalies_found: 42,
          confidence: 0.95,
        },
      },
      "text/plain": {
        type: "inline",
        data:
          "Analysis Complete\nProcessed 1,000 records\nFound 42 anomalies\nConfidence: 95%",
      },
    };

    const context = toAIContext(richOutput);
    assertEquals(
      context,
      "**Analysis Complete**\n\n- Processed 1,000 records\n- Found 42 anomalies\n- Confidence: 95%",
    );

    const structuredData = extractStructuredData(richOutput);
    assertObjectMatch(structuredData as Record<string, unknown>, {
      records_processed: 1000,
      anomalies_found: 42,
      confidence: 0.95,
    });
  });

  await t.step("should handle error output gracefully", () => {
    const richOutput: RichOutputData = {
      "text/plain": {
        type: "inline",
        data: "ValueError: invalid literal for int() with base 10: 'abc'",
      },
    };

    const context = toAIContext(richOutput);
    assertEquals(
      context,
      "ValueError: invalid literal for int() with base 10: 'abc'",
    );

    const bundle = ensureTextPlainFallback(toAIMediaBundle(richOutput));
    assertEquals(
      bundle["text/plain"],
      "ValueError: invalid literal for int() with base 10: 'abc'",
    );
  });
});

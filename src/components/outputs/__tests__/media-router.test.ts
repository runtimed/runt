/**
 * Tests for media-router.tsx - MIME type selection and routing.
 *
 * These tests verify the MIME type selection logic that determines
 * which renderer to use for Jupyter output data.
 */

import { describe, it, expect } from "vitest";
import { getSelectedMimeType, DEFAULT_PRIORITY } from "../media-router";

describe("getSelectedMimeType", () => {
  describe("priority-based selection", () => {
    it("returns highest priority MIME type when multiple available", () => {
      const data = {
        "text/plain": "Hello",
        "text/html": "<b>Hello</b>",
      };
      // text/html has higher priority than text/plain in DEFAULT_PRIORITY
      expect(getSelectedMimeType(data)).toBe("text/html");
    });

    it("returns widget MIME type over others", () => {
      const data = {
        "text/plain": "Widget fallback",
        "text/html": "<div>widget</div>",
        "application/vnd.jupyter.widget-view+json": { model_id: "abc" },
      };
      expect(getSelectedMimeType(data)).toBe(
        "application/vnd.jupyter.widget-view+json"
      );
    });

    it("returns image/png over text/plain", () => {
      const data = {
        "text/plain": "<Figure>",
        "image/png": "iVBORw0KGgo...",
      };
      expect(getSelectedMimeType(data)).toBe("image/png");
    });

    it("returns application/json over text/plain", () => {
      const data = {
        "text/plain": '{"key": "value"}',
        "application/json": { key: "value" },
      };
      expect(getSelectedMimeType(data)).toBe("application/json");
    });

    it("returns markdown over plain text", () => {
      const data = {
        "text/plain": "# Hello",
        "text/markdown": "# Hello",
      };
      expect(getSelectedMimeType(data)).toBe("text/markdown");
    });
  });

  describe("custom priority", () => {
    it("respects custom priority order", () => {
      const data = {
        "text/plain": "Hello",
        "text/html": "<b>Hello</b>",
        "application/json": { greeting: "Hello" },
      };
      // Custom priority puts text/plain first
      const customPriority = ["text/plain", "application/json", "text/html"];
      expect(getSelectedMimeType(data, customPriority)).toBe("text/plain");
    });

    it("falls back to first available when no priority match", () => {
      const data = {
        "custom/mime-type": "custom data",
      };
      // DEFAULT_PRIORITY doesn't include custom/mime-type
      expect(getSelectedMimeType(data)).toBe("custom/mime-type");
    });

    it("uses DEFAULT_PRIORITY when no custom priority provided", () => {
      const data = {
        "text/plain": "plain",
        "text/html": "html",
      };
      expect(getSelectedMimeType(data, DEFAULT_PRIORITY)).toBe("text/html");
    });
  });

  describe("empty/null handling", () => {
    it("returns null for empty data object", () => {
      expect(getSelectedMimeType({})).toBeNull();
    });

    it("skips null values", () => {
      const data = {
        "text/html": null,
        "text/plain": "fallback",
      };
      expect(getSelectedMimeType(data)).toBe("text/plain");
    });

    it("skips undefined values", () => {
      const data: Record<string, unknown> = {
        "text/html": undefined,
        "text/plain": "fallback",
      };
      expect(getSelectedMimeType(data)).toBe("text/plain");
    });

    it("returns null when all values are null", () => {
      const data = {
        "text/html": null,
        "text/plain": null,
      };
      expect(getSelectedMimeType(data)).toBeNull();
    });

    it("accepts empty string as valid value", () => {
      const data = {
        "text/plain": "",
      };
      // Empty string is falsy but not null/undefined
      expect(getSelectedMimeType(data)).toBe("text/plain");
    });

    it("accepts zero as valid value", () => {
      const data = {
        "application/json": 0,
      };
      expect(getSelectedMimeType(data)).toBe("application/json");
    });

    it("accepts false as valid value", () => {
      const data = {
        "application/json": false,
      };
      expect(getSelectedMimeType(data)).toBe("application/json");
    });
  });

  describe("various MIME types", () => {
    it("selects SVG over PNG", () => {
      const data = {
        "image/png": "png data",
        "image/svg+xml": "<svg>...</svg>",
      };
      expect(getSelectedMimeType(data)).toBe("image/svg+xml");
    });

    it("selects Plotly over HTML", () => {
      const data = {
        "text/html": "<div>plotly</div>",
        "application/vnd.plotly.v1+json": { data: [], layout: {} },
      };
      expect(getSelectedMimeType(data)).toBe("application/vnd.plotly.v1+json");
    });

    it("selects Vega-Lite v5 over v4", () => {
      const data = {
        "application/vnd.vegalite.v4+json": { $schema: "v4" },
        "application/vnd.vegalite.v5+json": { $schema: "v5" },
      };
      expect(getSelectedMimeType(data)).toBe("application/vnd.vegalite.v5+json");
    });

    it("handles GeoJSON", () => {
      const data = {
        "text/plain": "geojson",
        "application/geo+json": { type: "Feature" },
      };
      expect(getSelectedMimeType(data)).toBe("application/geo+json");
    });

    it("handles image/gif", () => {
      const data = {
        "text/plain": "<animation>",
        "image/gif": "R0lGODlh...",
      };
      expect(getSelectedMimeType(data)).toBe("image/gif");
    });

    it("handles image/webp", () => {
      const data = {
        "text/plain": "<image>",
        "image/webp": "UklGRl4A...",
      };
      expect(getSelectedMimeType(data)).toBe("image/webp");
    });

    it("handles image/jpeg", () => {
      const data = {
        "text/plain": "<image>",
        "image/jpeg": "/9j/4AAQ...",
      };
      expect(getSelectedMimeType(data)).toBe("image/jpeg");
    });
  });

  describe("DEFAULT_PRIORITY constant", () => {
    it("has widget as highest priority", () => {
      expect(DEFAULT_PRIORITY[0]).toBe(
        "application/vnd.jupyter.widget-view+json"
      );
    });

    it("has text/plain as lowest priority", () => {
      expect(DEFAULT_PRIORITY[DEFAULT_PRIORITY.length - 1]).toBe("text/plain");
    });

    it("includes all standard image types", () => {
      expect(DEFAULT_PRIORITY).toContain("image/png");
      expect(DEFAULT_PRIORITY).toContain("image/jpeg");
      expect(DEFAULT_PRIORITY).toContain("image/gif");
      expect(DEFAULT_PRIORITY).toContain("image/webp");
      expect(DEFAULT_PRIORITY).toContain("image/svg+xml");
    });

    it("includes rich visualization types", () => {
      expect(DEFAULT_PRIORITY).toContain("application/vnd.plotly.v1+json");
      expect(DEFAULT_PRIORITY).toContain("application/vnd.vegalite.v5+json");
      expect(DEFAULT_PRIORITY).toContain("application/vnd.vega.v5+json");
    });
  });
});

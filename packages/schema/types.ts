import { Schema } from "@livestore/livestore";

// Media representation schema for unified output system - defined first for use in events
export const MediaRepresentationSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("inline"),
    data: Schema.Any,
    metadata: Schema.optional(
      Schema.Record({ key: Schema.String, value: Schema.Any }),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("artifact"),
    artifactId: Schema.String,
    metadata: Schema.optional(
      Schema.Record({ key: Schema.String, value: Schema.Any }),
    ),
  }),
);

// TypeScript type for cell types
export type CellType = "code" | "markdown" | "sql" | "raw" | "ai";

// Schema for cell type validation
export const CellTypeSchema = Schema.Literal(
  "code",
  "markdown",
  "sql",
  "raw",
  "ai",
);

// Execution state types
export type ExecutionState =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "error";
export const ExecutionStateSchema = Schema.Literal(
  "idle",
  "queued",
  "running",
  "completed",
  "error",
);

// Output types
export type OutputType =
  | "multimedia_display"
  | "multimedia_result"
  | "terminal"
  | "markdown"
  | "error";
export const OutputTypeSchema = Schema.Literal(
  "multimedia_display",
  "multimedia_result",
  "terminal",
  "markdown",
  "error",
);

// Runtime status types
export type RuntimeStatus =
  | "starting"
  | "ready"
  | "busy"
  | "restarting"
  | "terminated";
export const RuntimeStatusSchema = Schema.Literal(
  "starting",
  "ready",
  "busy",
  "restarting",
  "terminated",
);

// Queue status types
export type QueueStatus =
  | "pending"
  | "assigned"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled";
export const QueueStatusSchema = Schema.Literal(
  "pending",
  "assigned",
  "executing",
  "completed",
  "failed",
  "cancelled",
);

// Actor types
export type ActorType = "human" | "runtime_agent";
export const ActorTypeSchema = Schema.Literal("human", "runtime_agent");

// Base generic types for MediaContainer system
export type InlineContainer<T = unknown> = {
  type: "inline";
  data: T;
  metadata?: Record<string, unknown> | undefined;
};

export type ArtifactContainer = {
  type: "artifact";
  artifactId: string;
  metadata?: Record<string, unknown> | undefined;
};

export type MediaContainer<T = unknown> =
  | InlineContainer<T>
  | ArtifactContainer;

// MIME type constants - core definitions used across frontend and backend
export const TEXT_MIME_TYPES = [
  "text/plain",
  "text/html",
  "text/markdown",
  "text/latex",
] as const;

export const APPLICATION_MIME_TYPES = [
  "application/json",
  "application/javascript",
] as const;

export const AI_TOOL_MIME_TYPES = [
  "application/vnd.anode.aitool+json",
  "application/vnd.anode.aitool.result+json",
] as const;

export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/gif",
] as const;

export const JUPYTER_MIME_TYPES = [
  "application/vnd.jupyter.widget-state+json",
  "application/vnd.jupyter.widget-view+json",
  "application/vnd.plotly.v1+json",
  "application/vnd.dataresource+json",
  "application/vnd.vegalite.v2+json",
  "application/vnd.vegalite.v3+json",
  "application/vnd.vegalite.v4+json",
  "application/vnd.vegalite.v5+json",
  "application/vnd.vegalite.v6+json",
  "application/vnd.vega.v3+json",
  "application/vnd.vega.v4+json",
  "application/vnd.vega.v5+json",
  "application/geo+json",
  "application/vdom.v1+json",
] as const;

export const KNOWN_MIME_TYPES = [
  ...TEXT_MIME_TYPES,
  ...APPLICATION_MIME_TYPES,
  ...IMAGE_MIME_TYPES,
  ...JUPYTER_MIME_TYPES,
  ...AI_TOOL_MIME_TYPES,
] as const;

export type TextMimeType = (typeof TEXT_MIME_TYPES)[number];
export type ApplicationMimeType = (typeof APPLICATION_MIME_TYPES)[number];
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];
export type JupyterMimeType = (typeof JUPYTER_MIME_TYPES)[number];
export type AiToolMimeType = (typeof AI_TOOL_MIME_TYPES)[number];
export type KnownMimeType = (typeof KNOWN_MIME_TYPES)[number];

/**
 * Type guard to check if a MIME type is a known text format
 */
export function isTextMimeType(mimeType: string): mimeType is TextMimeType {
  return (TEXT_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Type guard to check if a MIME type is a known application format
 */
export function isApplicationMimeType(
  mimeType: string,
): mimeType is ApplicationMimeType {
  return (APPLICATION_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Type guard to check if a MIME type is a known image format
 */
export function isImageMimeType(mimeType: string): mimeType is ImageMimeType {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Type guard to check if a MIME type is a Jupyter vendor format
 */
export function isJupyterMimeType(
  mimeType: string,
): mimeType is JupyterMimeType {
  return (JUPYTER_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Type guard to check if a MIME type is an AI tool format
 */
export function isAiToolMimeType(mimeType: string): mimeType is AiToolMimeType {
  return (AI_TOOL_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Type guard to check if a MIME type is any known format
 */
export function isKnownMimeType(mimeType: string): mimeType is KnownMimeType {
  return (KNOWN_MIME_TYPES as readonly string[]).includes(mimeType);
}

/**
 * Check if a MIME type is a JSON-based format (ends with +json)
 */
export function isJsonMimeType(mimeType: string): boolean {
  return mimeType.endsWith("+json") || mimeType === "application/json";
}

/**
 * Check if a MIME type appears to be text-based
 */
export function isTextBasedMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/javascript" ||
    mimeType === "image/svg+xml"
  );
}

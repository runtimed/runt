"use client";

import { lazy, type ReactNode, Suspense } from "react";
import { useMediaContext } from "./media-provider";

// Lazy load built-in output components for better bundle splitting
const AnsiOutput = lazy(() =>
  import("./ansi-output").then((m) => ({ default: m.AnsiOutput })),
);
const MarkdownOutput = lazy(() =>
  import("./markdown-output").then((m) => ({ default: m.MarkdownOutput })),
);
const HtmlOutput = lazy(() =>
  import("./html-output").then((m) => ({ default: m.HtmlOutput })),
);
const ImageOutput = lazy(() =>
  import("./image-output").then((m) => ({ default: m.ImageOutput })),
);
const SvgOutput = lazy(() =>
  import("./svg-output").then((m) => ({ default: m.SvgOutput })),
);
const JsonOutput = lazy(() =>
  import("./json-output").then((m) => ({ default: m.JsonOutput })),
);

/**
 * Default MIME type priority order for rendering.
 * Higher priority types are preferred when multiple are available.
 * Platforms can override this with the `priority` prop.
 */
export const DEFAULT_PRIORITY = [
  // Rich formats first
  "application/vnd.jupyter.widget-view+json",
  "application/vnd.plotly.v1+json",
  "application/vnd.vegalite.v5+json",
  "application/vnd.vegalite.v4+json",
  "application/vnd.vegalite.v3+json",
  "application/vnd.vega.v5+json",
  "application/vnd.vega.v4+json",
  "application/geo+json",
  // HTML and markdown
  "text/html",
  "text/markdown",
  // Images
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  // Structured data
  "application/json",
  // Plain text (fallback)
  "text/plain",
] as const;

type MimeType = (typeof DEFAULT_PRIORITY)[number] | string;

interface MediaData {
  [mimeType: string]: unknown;
}

interface MediaMetadata {
  [mimeType: string]:
    | {
        width?: number;
        height?: number;
        [key: string]: unknown;
      }
    | undefined;
}

/**
 * Props passed to custom renderer functions.
 */
export interface RendererProps {
  data: unknown;
  metadata: Record<string, unknown>;
  mimeType: string;
  className?: string;
}

/**
 * Custom renderer function type.
 */
export type CustomRenderer = (props: RendererProps) => ReactNode;

interface MediaRouterProps {
  /**
   * Output data object mapping MIME types to content.
   * e.g., { "text/plain": "Hello", "text/html": "<b>Hello</b>" }
   */
  data: MediaData;
  /**
   * Output metadata object mapping MIME types to their metadata.
   * e.g., { "image/png": { width: 400, height: 300 } }
   */
  metadata?: MediaMetadata;
  /**
   * Custom MIME type priority order. Types listed first are preferred.
   * Defaults to DEFAULT_PRIORITY. Your custom types should come first,
   * followed by spreading DEFAULT_PRIORITY for fallback.
   *
   * @example
   * ```tsx
   * priority={["application/vnd.plotly.v1+json", ...DEFAULT_PRIORITY]}
   * ```
   */
  priority?: readonly string[];
  /**
   * Custom renderers keyed by MIME type. Use this to handle MIME types
   * not supported by the built-in renderers, or to override built-ins.
   *
   * @example
   * ```tsx
   * renderers={{
   *   "application/vnd.plotly.v1+json": ({ data }) => <PlotlyChart data={data} />,
   *   "application/geo+json": ({ data }) => <GeoJsonMap data={data} />,
   * }}
   * ```
   */
  renderers?: Record<string, CustomRenderer>;
  /**
   * Whether to allow unsafe HTML rendering (requires iframe).
   * Applies to text/html and text/markdown MIME types.
   */
  unsafe?: boolean;
  /**
   * Custom fallback component when no supported MIME type is found.
   */
  fallback?: ReactNode;
  /**
   * Loading component shown while lazy-loading output components.
   */
  loading?: ReactNode;
  /**
   * Additional CSS classes passed to the rendered output.
   */
  className?: string;
}

/**
 * Select the best MIME type from available data based on priority.
 */
function selectMimeType(
  data: MediaData,
  priority: readonly string[],
): MimeType | null {
  const availableTypes = Object.keys(data);

  // Check priority list first
  for (const mimeType of priority) {
    if (availableTypes.includes(mimeType) && data[mimeType] != null) {
      return mimeType;
    }
  }

  // Fall back to first available type
  const firstAvailable = availableTypes.find((type) => data[type] != null);
  return firstAvailable || null;
}

/**
 * Default loading spinner
 */
function DefaultLoading() {
  return (
    <div className="flex items-center justify-center py-4 text-gray-400">
      <svg
        className="h-5 w-5 animate-spin"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    </div>
  );
}

/**
 * MediaRouter component for rendering Jupyter outputs based on MIME type.
 *
 * Automatically selects the best available renderer for the output data,
 * following Jupyter's MIME type priority conventions. Supports custom
 * renderers and priority ordering for platform-specific MIME types.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <MediaRouter
 *   data={{
 *     "text/plain": "Hello, World!",
 *     "text/html": "<b>Hello, World!</b>"
 *   }}
 * />
 *
 * // With custom renderers
 * <MediaRouter
 *   data={output.data}
 *   metadata={output.metadata}
 *   priority={["application/vnd.plotly.v1+json", ...DEFAULT_PRIORITY]}
 *   renderers={{
 *     "application/vnd.plotly.v1+json": ({ data }) => <PlotlyChart data={data} />,
 *   }}
 * />
 * ```
 */
export function MediaRouter({
  data,
  metadata = {},
  priority: priorityProp,
  renderers: renderersProp,
  unsafe: unsafeProp,
  fallback,
  loading,
  className = "",
}: MediaRouterProps) {
  const ctx = useMediaContext();

  // Props override context, context overrides built-in defaults
  const priority = priorityProp ?? ctx?.priority ?? DEFAULT_PRIORITY;
  const renderers = renderersProp ?? ctx?.renderers ?? {};
  const unsafe = unsafeProp ?? ctx?.unsafe ?? false;

  const mimeType = selectMimeType(data, priority);

  if (!mimeType) {
    return fallback ? (
      fallback
    ) : (
      <div className="py-2 text-sm text-gray-500">No displayable output</div>
    );
  }

  const content = data[mimeType];
  const mimeMetadata = (metadata[mimeType] || {}) as Record<string, unknown>;
  const loadingComponent = loading || <DefaultLoading />;

  // Check for custom renderer first
  if (renderers[mimeType]) {
    const customRenderer = renderers[mimeType];
    return (
      <Suspense fallback={loadingComponent}>
        {customRenderer({
          data: content,
          metadata: mimeMetadata,
          mimeType,
          className,
        })}
      </Suspense>
    );
  }

  const renderBuiltIn = () => {
    // Text/Markdown
    if (mimeType === "text/markdown") {
      return (
        <MarkdownOutput
          content={String(content)}
          unsafe={unsafe}
          className={className}
        />
      );
    }

    // HTML
    if (mimeType === "text/html") {
      return (
        <HtmlOutput
          content={String(content)}
          unsafe={unsafe}
          className={className}
        />
      );
    }

    // Images (not SVG)
    if (mimeType.startsWith("image/") && mimeType !== "image/svg+xml") {
      const imageType = mimeType as
        | "image/png"
        | "image/jpeg"
        | "image/gif"
        | "image/webp";
      return (
        <ImageOutput
          data={String(content)}
          mediaType={imageType}
          width={mimeMetadata.width as number | undefined}
          height={mimeMetadata.height as number | undefined}
          className={className}
        />
      );
    }

    // SVG
    if (mimeType === "image/svg+xml") {
      return <SvgOutput data={String(content)} className={className} />;
    }

    // JSON and structured data (but not custom +json types without a renderer)
    if (mimeType === "application/json") {
      return (
        <JsonOutput
          data={content}
          collapsed={mimeMetadata.collapsed as boolean | number | undefined}
          className={className}
        />
      );
    }

    // Plain text (may contain ANSI)
    if (mimeType === "text/plain") {
      return <AnsiOutput className={className}>{String(content)}</AnsiOutput>;
    }

    // Unknown +json types without custom renderer - show as JSON
    if (mimeType.includes("+json")) {
      return (
        <JsonOutput
          data={content}
          collapsed={mimeMetadata.collapsed as boolean | number | undefined}
          className={className}
        />
      );
    }

    // Fallback: render as plain text
    return <AnsiOutput className={className}>{String(content)}</AnsiOutput>;
  };

  return <Suspense fallback={loadingComponent}>{renderBuiltIn()}</Suspense>;
}

/**
 * Get the selected MIME type for debugging/display purposes.
 */
export function getSelectedMimeType(
  data: MediaData,
  priority: readonly string[] = DEFAULT_PRIORITY,
): string | null {
  return selectMimeType(data, priority);
}

"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  AnsiErrorOutput,
  AnsiStreamOutput,
} from "@/components/outputs/ansi-output";
import { MediaRouter, DEFAULT_PRIORITY } from "@/components/outputs/media-router";
import {
  IsolatedFrame,
  type IsolatedFrameHandle,
} from "@/components/outputs/isolated";

/**
 * Jupyter output types based on the nbformat spec.
 */
export type JupyterOutput =
  | {
      output_type: "execute_result" | "display_data";
      data: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      execution_count?: number | null;
    }
  | {
      output_type: "stream";
      name: "stdout" | "stderr";
      text: string | string[];
    }
  | {
      output_type: "error";
      ename: string;
      evalue: string;
      traceback: string[];
    };

interface OutputAreaProps {
  /**
   * Array of Jupyter outputs to render.
   */
  outputs: JupyterOutput[];
  /**
   * Whether the output area is collapsed.
   */
  collapsed?: boolean;
  /**
   * Callback when collapse state is toggled.
   */
  onToggleCollapse?: () => void;
  /**
   * Maximum height before scrolling. Set to enable scroll behavior.
   */
  maxHeight?: number;
  /**
   * Additional CSS classes for the container.
   */
  className?: string;
  /**
   * Custom renderers passed to MediaRouter.
   */
  renderers?: Record<
    string,
    (props: {
      data: unknown;
      metadata: Record<string, unknown>;
      mimeType: string;
      className?: string;
    }) => ReactNode
  >;
  /**
   * Custom MIME type priority order.
   */
  priority?: readonly string[];
  /**
   * Whether to allow unsafe HTML rendering.
   */
  unsafe?: boolean;
  /**
   * Force isolation mode. When true, all outputs render in an isolated iframe.
   * When "auto" (default), isolation is used when any output needs it.
   * When false, outputs render in-DOM (less secure but faster for simple outputs).
   */
  isolated?: boolean | "auto";
  /**
   * Callback when a link is clicked in isolated outputs.
   */
  onLinkClick?: (url: string, newTab: boolean) => void;
  /**
   * Callback when widget state is updated in isolated outputs.
   */
  onWidgetUpdate?: (commId: string, state: Record<string, unknown>) => void;
}

/**
 * Normalize stream text (can be string or string array).
 */
function normalizeText(text: string | string[]): string {
  return Array.isArray(text) ? text.join("") : text;
}

/**
 * MIME types that require iframe isolation for security.
 * These types can contain executable scripts or interactive content.
 */
const ISOLATED_MIME_TYPES = new Set([
  "text/html",
  "text/markdown",
  "image/svg+xml",
  "application/vnd.jupyter.widget-view+json",
  "application/vnd.plotly.v1+json",
  "application/vnd.vegalite.v5+json",
  "application/vnd.vegalite.v4+json",
  "application/vnd.vegalite.v3+json",
  "application/vnd.vega.v5+json",
  "application/vnd.vega.v4+json",
]);

/**
 * Select the best MIME type from available data based on priority.
 */
function selectMimeType(
  data: Record<string, unknown>,
  priority: readonly string[] = DEFAULT_PRIORITY
): string | null {
  const availableTypes = Object.keys(data);
  for (const mimeType of priority) {
    if (availableTypes.includes(mimeType) && data[mimeType] != null) {
      return mimeType;
    }
  }
  const firstAvailable = availableTypes.find((type) => data[type] != null);
  return firstAvailable || null;
}

/**
 * Check if a single output needs iframe isolation.
 */
function outputNeedsIsolation(
  output: JupyterOutput,
  priority: readonly string[] = DEFAULT_PRIORITY
): boolean {
  if (output.output_type === "execute_result" || output.output_type === "display_data") {
    const mimeType = selectMimeType(output.data, priority);
    return mimeType ? ISOLATED_MIME_TYPES.has(mimeType) : false;
  }
  // stream and error outputs don't need isolation
  return false;
}

/**
 * Check if any outputs in the array need iframe isolation.
 * If any output needs isolation, ALL outputs should go to the iframe.
 */
function anyOutputNeedsIsolation(
  outputs: JupyterOutput[],
  priority: readonly string[] = DEFAULT_PRIORITY
): boolean {
  return outputs.some((output) => outputNeedsIsolation(output, priority));
}

/**
 * Render a single Jupyter output based on its type.
 */
function renderOutput(
  output: JupyterOutput,
  index: number,
  renderers?: OutputAreaProps["renderers"],
  priority?: readonly string[],
  unsafe?: boolean,
) {
  const key = `output-${index}`;

  switch (output.output_type) {
    case "execute_result":
    case "display_data":
      return (
        <MediaRouter
          key={key}
          data={output.data}
          metadata={
            output.metadata as Record<
              string,
              Record<string, unknown> | undefined
            >
          }
          renderers={renderers}
          priority={priority}
          unsafe={unsafe}
        />
      );

    case "stream":
      return (
        <AnsiStreamOutput
          key={key}
          text={normalizeText(output.text)}
          streamName={output.name}
        />
      );

    case "error":
      return (
        <AnsiErrorOutput
          key={key}
          ename={output.ename}
          evalue={output.evalue}
          traceback={output.traceback}
        />
      );

    default:
      return null;
  }
}

/**
 * OutputArea renders multiple Jupyter outputs with proper layout.
 *
 * Handles all Jupyter output types: execute_result, display_data, stream, and error.
 * Supports collapsible state and scroll behavior for large outputs.
 *
 * @example
 * ```tsx
 * <OutputArea
 *   outputs={cell.outputs}
 *   collapsed={outputsCollapsed}
 *   onToggleCollapse={() => setOutputsCollapsed(!outputsCollapsed)}
 *   maxHeight={400}
 * />
 * ```
 */
export function OutputArea({
  outputs,
  collapsed = false,
  onToggleCollapse,
  maxHeight,
  className,
  renderers,
  priority = DEFAULT_PRIORITY,
  unsafe = false,
  isolated = "auto",
  onLinkClick,
  onWidgetUpdate,
}: OutputAreaProps) {
  const id = useId();
  const frameRef = useRef<IsolatedFrameHandle>(null);

  // Empty state: render nothing
  if (outputs.length === 0) {
    return null;
  }

  // Determine if we should use isolation
  const shouldIsolate =
    isolated === true || (isolated === "auto" && anyOutputNeedsIsolation(outputs, priority));

  const hasCollapseControl = onToggleCollapse !== undefined;
  const outputCount = outputs.length;

  // Callback to render outputs in isolated frame
  const renderIsolatedOutputs = useCallback(() => {
    if (!frameRef.current) return;

    // First, clear existing content
    frameRef.current.clear();

    // Render each output, using append for all but the first
    outputs.forEach((output, index) => {
      const append = index > 0; // First output replaces, rest append

      if (output.output_type === "execute_result" || output.output_type === "display_data") {
        const mimeType = selectMimeType(output.data, priority);
        if (mimeType) {
          frameRef.current?.render({
            mimeType,
            data: output.data[mimeType],
            metadata: output.metadata?.[mimeType] as Record<string, unknown> | undefined,
            outputIndex: index,
            append,
          });
        }
      } else if (output.output_type === "stream") {
        // Render stream as plain text with ANSI
        frameRef.current?.render({
          mimeType: "text/plain",
          data: normalizeText(output.text),
          metadata: { streamName: output.name },
          outputIndex: index,
          append,
        });
      } else if (output.output_type === "error") {
        // Render error as HTML with traceback
        const errorHtml = `<div class="error">
          <pre>${output.traceback.join("\n")}</pre>
        </div>`;
        frameRef.current?.render({
          mimeType: "text/html",
          data: errorHtml,
          outputIndex: index,
          append,
        });
      }
    });
  }, [outputs, priority]);

  return (
    <div data-slot="output-area" className={cn("output-area", className)}>
      {/* Collapse toggle */}
      {hasCollapseControl && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-expanded={!collapsed}
          aria-controls={id}
        >
          {collapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          <span>
            {collapsed
              ? `Show ${outputCount} output${outputCount > 1 ? "s" : ""}`
              : "Hide outputs"}
          </span>
        </button>
      )}

      {/* Output content */}
      {!collapsed && (
        <div
          id={id}
          className={cn("space-y-2", maxHeight && "overflow-y-auto")}
          style={maxHeight ? { maxHeight: `${maxHeight}px` } : undefined}
        >
          {shouldIsolate ? (
            <IsolatedFrame
              ref={frameRef}
              darkMode={true}
              useReactRenderer={true}
              minHeight={24}
              maxHeight={maxHeight ?? 2000}
              onReady={renderIsolatedOutputs}
              onLinkClick={onLinkClick}
              onWidgetUpdate={onWidgetUpdate}
              onError={(err) => console.error("[OutputArea] iframe error:", err)}
            />
          ) : (
            outputs.map((output, index) =>
              renderOutput(output, index, renderers, priority, unsafe),
            )
          )}
        </div>
      )}
    </div>
  );
}

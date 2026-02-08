"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useId } from "react";
import { cn } from "@runtimed/ui/lib/utils";
import {
  AnsiErrorOutput,
  AnsiStreamOutput,
} from "@runtimed/ui/components/outputs/ansi-output";
import { MediaRouter } from "@runtimed/ui/components/outputs/media-router";

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
}

/**
 * Normalize stream text (can be string or string array).
 */
function normalizeText(text: string | string[]): string {
  return Array.isArray(text) ? text.join("") : text;
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
  priority,
  unsafe = false,
}: OutputAreaProps) {
  const id = useId();

  // Empty state: render nothing
  if (outputs.length === 0) {
    return null;
  }

  const hasCollapseControl = onToggleCollapse !== undefined;
  const outputCount = outputs.length;

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
          {outputs.map((output, index) =>
            renderOutput(output, index, renderers, priority, unsafe),
          )}
        </div>
      )}
    </div>
  );
}

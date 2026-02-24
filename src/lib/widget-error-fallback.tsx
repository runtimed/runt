"use client";

import { cn } from "@/lib/utils";

export interface WidgetErrorFallbackProps {
  /** The error that was caught */
  error: Error;
  /** The widget model ID */
  modelId: string;
  /** Optional widget model name for display */
  modelName?: string;
  /** Callback to retry rendering */
  onRetry?: () => void;
}

/**
 * Fallback UI for widget rendering errors.
 *
 * Displays an error message with optional retry button.
 * Styled to match UnsupportedWidget patterns.
 */
export function WidgetErrorFallback({
  error,
  modelId,
  modelName,
  onRetry,
}: WidgetErrorFallbackProps) {
  return (
    <div
      className={cn(
        "rounded border border-dashed border-red-300 p-3 text-sm dark:border-red-800",
        "bg-red-50/50 dark:bg-red-950/20",
      )}
      data-widget-id={modelId}
      data-widget-error="true"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-red-700 dark:text-red-400">
            Widget error{modelName && `: ${modelName}`}
          </div>
          <div className="mt-1 font-mono text-xs text-red-600/70 dark:text-red-400/60">
            {error.message}
          </div>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-xs text-red-600 underline hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

"use client";

import { cn } from "@/lib/utils";

export interface OutputErrorFallbackProps {
  /** The error that was caught */
  error: Error;
  /** Optional index of the output (0-based) for display */
  outputIndex?: number;
  /** Callback to retry rendering */
  onRetry?: () => void;
}

/**
 * Fallback UI for output rendering errors.
 *
 * Displays an error message with optional retry button.
 * Styled to match AnsiErrorOutput patterns.
 */
export function OutputErrorFallback({
  error,
  outputIndex,
  onRetry,
}: OutputErrorFallbackProps) {
  return (
    <div
      data-slot="output-error"
      className={cn(
        "border-l-2 border-red-200 dark:border-red-800 py-3 pl-3 pr-2",
        "rounded-r bg-red-50/50 dark:bg-red-950/20",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-red-700 dark:text-red-400">
            Output rendering failed
            {outputIndex !== undefined && ` (output ${outputIndex + 1})`}
          </div>
          <div className="mt-1 font-mono text-xs text-red-600/80 dark:text-red-400/70">
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

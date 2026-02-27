import { AlertTriangle, RefreshCw, X } from "lucide-react";
import type { PoolError } from "../types";

interface PoolErrorBannerProps {
  uvError: PoolError | null;
  condaError: PoolError | null;
  onDismiss?: () => void;
}

/**
 * Banner showing prewarm pool errors (failed to prepare default environments).
 *
 * Helps users identify and fix invalid default packages in their settings.
 */
export function PoolErrorBanner({
  uvError,
  condaError,
  onDismiss,
}: PoolErrorBannerProps) {
  // Don't show if no errors
  if (!uvError && !condaError) {
    return null;
  }

  // Combine errors for display
  const errors: Array<{ type: "uv" | "conda"; error: PoolError }> = [];
  if (uvError) errors.push({ type: "uv", error: uvError });
  if (condaError) errors.push({ type: "conda", error: condaError });

  return (
    <div className="flex flex-col gap-1 bg-amber-600/90 px-3 py-2 text-xs text-white">
      {errors.map(({ type, error }, index) => (
        <div key={type} className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-3 w-3 flex-shrink-0" />
            <span className="font-medium flex-shrink-0">
              {type === "uv" ? "UV" : "Conda"} pool error
            </span>
            <span className="text-amber-200 flex-shrink-0">—</span>
            <span className="text-amber-100 truncate">
              {error.failed_package
                ? `Failed to install "${error.failed_package}"`
                : error.message}
            </span>
            {error.retry_in_secs > 0 && (
              <>
                <span className="text-amber-200 flex-shrink-0">·</span>
                <span className="text-amber-200 flex-shrink-0 flex items-center gap-1">
                  <RefreshCw className="h-3 w-3" />
                  Retry in {formatRetryTime(error.retry_in_secs)}
                </span>
              </>
            )}
          </div>
          {index === 0 && onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded p-0.5 hover:bg-amber-500/50 transition-colors flex-shrink-0"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      <div className="text-amber-200 text-[10px] mt-0.5">
        Check your default packages in Settings. Invalid packages prevent
        environment prewarming.
      </div>
    </div>
  );
}

function formatRetryTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}

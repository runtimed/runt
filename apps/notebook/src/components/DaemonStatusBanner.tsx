import { AlertTriangle, Loader2, RefreshCw, X } from "lucide-react";

/**
 * Error information for a prewarm pool that is failing to create environments.
 */
export interface PoolError {
  message: string;
  failed_package?: string;
  consecutive_failures: number;
  retry_in_secs: number;
}

/**
 * Pool state broadcast from daemon.
 */
export interface PoolState {
  uv_error: PoolError | null;
  conda_error: PoolError | null;
}

/**
 * Status of the daemon during startup or operation.
 * Matches the DaemonProgress enum from Rust.
 */
export type DaemonStatus =
  | { status: "checking" }
  | { status: "installing" }
  | { status: "upgrading" }
  | { status: "starting" }
  | { status: "waiting_for_ready"; attempt: number; max_attempts: number }
  | { status: "ready"; endpoint: string }
  | { status: "failed"; error: string }
  | null;

interface DaemonStatusBannerProps {
  status: DaemonStatus;
  poolState?: PoolState | null;
  onDismiss?: () => void;
  onRetry?: () => void;
  onDismissPoolError?: () => void;
}

/**
 * Banner component showing daemon startup progress or errors.
 *
 * Shows different visual states:
 * - Blue/info with spinner: Installing, upgrading, starting, waiting
 * - Amber/warning: Failed state with retry button
 * - Amber/warning: Pool errors (invalid packages in settings)
 * - Hidden: Ready state or null
 */
export function DaemonStatusBanner({
  status,
  poolState,
  onDismiss,
  onRetry,
  onDismissPoolError,
}: DaemonStatusBannerProps) {
  // Check for pool errors (show even when daemon is ready)
  const hasPoolError = poolState?.uv_error || poolState?.conda_error;

  // Determine what to show based on status and pool errors
  // Priority: failed > progress > pool_error > nothing

  // 1. Failed state takes priority - show error with retry
  if (status?.status === "failed") {
    return (
      <div className="flex items-center justify-between gap-2 bg-amber-600/90 px-3 py-1 text-xs text-white">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
          <span className="font-medium flex-shrink-0">Runtime unavailable</span>
          <span className="text-amber-200 flex-shrink-0">—</span>
          <span className="text-amber-100 truncate">{status.error}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-amber-500/50 transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Retry</span>
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded p-0.5 hover:bg-amber-500/50 transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // 2. Progress states - show spinner
  if (status && status.status !== "ready") {
    return (
      <div className="flex items-center gap-2 bg-sky-600/90 px-3 py-1 text-xs text-white">
        <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />
        <span>{getProgressMessage(status)}</span>
      </div>
    );
  }

  // 3. Pool errors - show when daemon is ready but pool has issues
  if (hasPoolError) {
    const errors: Array<{ type: "uv" | "conda"; error: PoolError }> = [];
    if (poolState?.uv_error) {
      errors.push({ type: "uv", error: poolState.uv_error });
    }
    if (poolState?.conda_error) {
      errors.push({ type: "conda", error: poolState.conda_error });
    }

    return (
      <div className="flex flex-col gap-1 bg-amber-600/90 px-3 py-1.5 text-xs text-white">
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
                  <span className="text-amber-200 flex-shrink-0">
                    Retry in {formatRetryTime(error.retry_in_secs)}
                  </span>
                </>
              )}
            </div>
            {index === 0 && onDismissPoolError && (
              <button
                type="button"
                onClick={onDismissPoolError}
                className="rounded p-0.5 hover:bg-amber-500/50 transition-colors flex-shrink-0"
                aria-label="Dismiss"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        <div className="text-amber-200 text-[10px]">
          Check your default packages in Settings. Invalid packages prevent
          environment prewarming.
        </div>
      </div>
    );
  }

  // 4. Nothing to show (status is null or ready, no pool errors)
  return null;
}

function getProgressMessage(
  status:
    | { status: "checking" }
    | { status: "installing" }
    | { status: "upgrading" }
    | { status: "starting" }
    | { status: "waiting_for_ready"; attempt: number; max_attempts: number },
): string {
  switch (status.status) {
    case "checking":
      return "Checking runtime status...";
    case "installing":
      return "Installing runtime (first launch)...";
    case "upgrading":
      return "Upgrading runtime...";
    case "starting":
      return "Starting runtime...";
    case "waiting_for_ready":
      return `Starting runtime (${status.attempt}/${status.max_attempts})...`;
  }
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

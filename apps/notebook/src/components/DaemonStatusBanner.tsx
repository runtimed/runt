import { AlertTriangle, Loader2, X } from "lucide-react";

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
  onDismiss?: () => void;
}

/**
 * Banner component showing daemon startup progress or errors.
 *
 * Shows different visual states:
 * - Blue/info with spinner: Installing, upgrading, starting, waiting
 * - Red/error: Failed state with dismissible error message
 * - Hidden: Ready state or null
 */
export function DaemonStatusBanner({
  status,
  onDismiss,
}: DaemonStatusBannerProps) {
  // Don't show banner for ready or null state
  if (!status || status.status === "ready") {
    return null;
  }

  // Failed state - red banner with error message
  if (status.status === "failed") {
    return (
      <div className="flex items-center justify-between gap-3 bg-red-600/90 px-3 py-2 text-sm text-white">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span className="font-medium">Runtime unavailable</span>
          <span className="text-red-200">—</span>
          <span className="text-red-100">{status.error}</span>
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded p-1 hover:bg-red-500/50 transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  // Progress states - blue banner with spinner
  const message = getProgressMessage(status);

  return (
    <div className="flex items-center gap-2 bg-blue-600/90 px-3 py-2 text-sm text-white">
      <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function getProgressMessage(
  status: Exclude<
    DaemonStatus,
    null | { status: "ready" } | { status: "failed" }
  >,
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

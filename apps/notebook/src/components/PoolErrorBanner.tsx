import { AlertCircle } from "lucide-react";
import type { PoolError } from "../types";

interface PoolErrorBannerProps {
  uvError: PoolError | null;
  condaError: PoolError | null;
}

/**
 * Banner component that displays prewarm pool errors.
 *
 * Shows when the daemon fails to create prewarmed environments due to
 * invalid packages in settings. The banner auto-dismisses when the error
 * clears (user fixes the typo and daemon succeeds).
 */
export function PoolErrorBanner({ uvError, condaError }: PoolErrorBannerProps) {
  if (!uvError && !condaError) {
    return null;
  }

  return (
    <div className="border-b bg-red-500/10 border-red-200 dark:border-red-900 px-3 py-2">
      <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-400">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 space-y-2">
          {uvError && <PoolErrorItem label="uv" error={uvError} />}
          {condaError && <PoolErrorItem label="Conda" error={condaError} />}
        </div>
      </div>
    </div>
  );
}

function PoolErrorItem({ label, error }: { label: string; error: PoolError }) {
  return (
    <div>
      <div className="font-medium">
        {label} prewarmed environment failed
        {error.failed_package && (
          <span className="font-normal">
            {" "}
            — package{" "}
            <code className="rounded bg-red-500/20 px-1">
              {error.failed_package}
            </code>{" "}
            not found
          </span>
        )}
      </div>
      <div className="mt-0.5 opacity-80">
        Check {label === "uv" ? "uv" : "conda"}.default_packages in settings
      </div>
      {error.retry_in_secs > 0 && (
        <div className="mt-0.5 text-[10px] opacity-60">
          Retry in {error.retry_in_secs}s (attempt{" "}
          {error.consecutive_failures + 1})
        </div>
      )}
    </div>
  );
}

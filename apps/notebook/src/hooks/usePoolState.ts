import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import type { PoolError, PoolStateEvent } from "../types";

export interface PoolState {
  /** UV pool error (null if healthy) */
  uvError: PoolError | null;
  /** Conda pool error (null if healthy) */
  condaError: PoolError | null;
  /** Whether there's any pool error */
  hasError: boolean;
}

/**
 * Hook to subscribe to daemon pool state broadcasts.
 *
 * Returns error information when the prewarm pool fails to create
 * environments (e.g., due to invalid default packages in settings).
 */
export function usePoolState(): PoolState & { dismiss: () => void } {
  const [uvError, setUvError] = useState<PoolError | null>(null);
  const [condaError, setCondaError] = useState<PoolError | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const unlisten = listen<PoolStateEvent>("pool:state", (event) => {
      if (cancelled) return;

      const payload = event.payload;

      // Update error states
      setUvError(payload.uv_error ?? null);
      setCondaError(payload.conda_error ?? null);

      // If errors clear, reset dismissed state so future errors show
      if (!payload.uv_error && !payload.conda_error) {
        setDismissed(false);
      }
    });

    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
    };
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  // Only show errors if not dismissed
  const effectiveUvError = dismissed ? null : uvError;
  const effectiveCondaError = dismissed ? null : condaError;

  return {
    uvError: effectiveUvError,
    condaError: effectiveCondaError,
    hasError: Boolean(effectiveUvError || effectiveCondaError),
    dismiss,
  };
}

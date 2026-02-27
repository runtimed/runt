import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { PoolError, SyncedDaemonState } from "../types";

export interface PoolState {
  uvError: PoolError | null;
  condaError: PoolError | null;
}

/**
 * Hook to subscribe to synchronized daemon state (pool health).
 *
 * Returns the current UV and Conda pool error state. The daemon sends
 * the current state immediately on connection and pushes updates when
 * state changes.
 *
 * The hook auto-clears errors when the daemon reports success, so there's
 * no need for manual dismiss - it reflects the actual daemon state.
 */
export function usePoolState(): PoolState {
  const [uvError, setUvError] = useState<PoolError | null>(null);
  const [condaError, setCondaError] = useState<PoolError | null>(null);

  useEffect(() => {
    let cancelled = false;

    const unlistenPromise = listen<SyncedDaemonState>(
      "daemon:state",
      (event) => {
        if (cancelled) return;
        setUvError(event.payload.uv_error);
        setCondaError(event.payload.conda_error);
      },
    );

    return () => {
      cancelled = true;
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  return { uvError, condaError };
}

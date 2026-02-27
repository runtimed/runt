import { invoke } from "@tauri-apps/api/core";
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
 * Returns the current UV and Conda pool error state. The hook:
 * 1. Fetches the current state immediately on mount via Tauri command
 * 2. Listens for state change events for live updates
 *
 * The hook auto-clears errors when the daemon reports success, so there's
 * no need for manual dismiss - it reflects the actual daemon state.
 */
export function usePoolState(): PoolState {
  const [uvError, setUvError] = useState<PoolError | null>(null);
  const [condaError, setCondaError] = useState<PoolError | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Fetch initial state immediately (don't wait for events)
    console.log("[usePoolState] Fetching initial daemon state...");
    invoke<SyncedDaemonState>("get_daemon_state")
      .then((state) => {
        console.log("[usePoolState] Got initial state:", state);
        if (cancelled) return;
        setUvError(state.uv_error);
        setCondaError(state.conda_error);
      })
      .catch((e) => {
        console.warn("[usePoolState] Failed to get initial state:", e);
      });

    // Listen for state change events
    const unlistenPromise = listen<SyncedDaemonState>(
      "daemon:state",
      (event) => {
        console.log(
          "[usePoolState] Received daemon:state event:",
          event.payload,
        );
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
